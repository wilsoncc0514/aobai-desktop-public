use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

const MAX_SKINS: usize = 50;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ATLAS_BYTES: u64 = 20 * 1024 * 1024;
const ATLAS_WIDTH: u32 = 1536;
const ATLAS_HEIGHT: u32 = 2288;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetManifest {
    id: String,
    display_name: String,
    #[allow(dead_code)]
    description: Option<String>,
    sprite_version_number: u8,
    spritesheet_path: String,
    spritesheet2x_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkinInfo {
    pub id: String,
    pub display_name: String,
    pub atlas_path: String,
    pub atlas2x_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinScanResult {
    pub root_path: String,
    pub skins: Vec<SkinInfo>,
    pub warnings: Vec<String>,
}

pub fn skin_root() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("AOBAI_SKIN_DIR") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(debug_assertions)]
    {
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "开发目录无效".to_owned())?
            .join("skin"))
    }
    #[cfg(not(debug_assertions))]
    {
        let executable =
            std::env::current_exe().map_err(|error| format!("无法定位程序目录：{error}"))?;
        let runtime = executable
            .parent()
            .ok_or_else(|| "程序目录无效".to_owned())?;
        Ok(runtime.parent().unwrap_or(runtime).join("skin"))
    }
}

pub fn scan(root: &Path) -> SkinScanResult {
    let mut result = SkinScanResult {
        root_path: root.to_string_lossy().into_owned(),
        skins: Vec::new(),
        warnings: Vec::new(),
    };
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            result.warnings.push(format!("无法读取 skin 目录：{error}"));
            return result;
        }
    };
    let mut directories = entries.filter_map(Result::ok).collect::<Vec<_>>();
    directories.sort_by_key(|entry| entry.file_name());
    for entry in directories.into_iter().take(MAX_SKINS) {
        let path = entry.path();
        if !path.is_dir()
            || entry
                .file_type()
                .map(|kind| kind.is_symlink())
                .unwrap_or(true)
        {
            continue;
        }
        match validate_skin(&path) {
            Ok((skin, _)) if result.skins.iter().any(|known| known.id == skin.id) => {
                result
                    .warnings
                    .push(format!("{}：皮肤 id 重复", path.display()));
            }
            Ok((skin, warning)) => {
                result.skins.push(skin);
                if let Some(warning) = warning {
                    result
                        .warnings
                        .push(format!("{}：{warning}", path.display()));
                }
            }
            Err(error) => result.warnings.push(format!("{}：{error}", path.display())),
        }
    }
    result
}

fn validate_skin(directory: &Path) -> Result<(SkinInfo, Option<String>), String> {
    let manifest_path = directory.join("pet.json");
    if fs::symlink_metadata(&manifest_path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true)
    {
        return Err("pet.json 不允许是符号链接".to_owned());
    }
    let metadata =
        fs::metadata(&manifest_path).map_err(|error| format!("缺少 pet.json：{error}"))?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("pet.json 超过 64KB".to_owned());
    }
    let manifest: PetManifest = serde_json::from_slice(
        &fs::read(&manifest_path).map_err(|error| format!("无法读取 pet.json：{error}"))?,
    )
    .map_err(|error| format!("pet.json 无法解析：{error}"))?;
    if !valid_id(&manifest.id) {
        return Err("id 必须是 1–48 位 ASCII 字母、数字或连字符".to_owned());
    }
    if manifest.display_name.trim().is_empty() || manifest.display_name.chars().count() > 40 {
        return Err("displayName 必须为 1–40 个字符".to_owned());
    }
    if manifest.sprite_version_number != 2 {
        return Err("只支持 spriteVersionNumber 2".to_owned());
    }
    let atlas = validate_atlas_path(directory, &manifest.spritesheet_path, 1)?;
    let (atlas2x_path, warning) = match manifest.spritesheet2x_path {
        Some(path) => match validate_atlas_path(directory, &path, 2) {
            Ok(atlas) => (Some(atlas.to_string_lossy().into_owned()), None),
            Err(error) => (None, Some(format!("高清图集不可用，使用标准图集：{error}"))),
        },
        None => (None, None),
    };
    Ok((
        SkinInfo {
            id: manifest.id,
            display_name: manifest.display_name,
            atlas_path: atlas.to_string_lossy().into_owned(),
            atlas2x_path,
        },
        warning,
    ))
}

fn validate_atlas_path(directory: &Path, path: &str, scale: u32) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("spritesheetPath 必须是安全的相对文件名".to_owned());
    }
    let extension = relative
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "webp") {
        return Err("图集只允许 PNG 或 WebP".to_owned());
    }
    let atlas = directory.join(relative);
    let canonical_dir = directory
        .canonicalize()
        .map_err(|error| format!("皮肤目录无效：{error}"))?;
    let canonical_atlas = atlas
        .canonicalize()
        .map_err(|error| format!("图集不存在：{error}"))?;
    if !canonical_atlas.starts_with(&canonical_dir) {
        return Err("图集路径越出皮肤目录".to_owned());
    }
    let atlas_metadata =
        fs::metadata(&canonical_atlas).map_err(|error| format!("无法读取图集：{error}"))?;
    if !atlas_metadata.is_file() || atlas_metadata.len() > MAX_ATLAS_BYTES {
        return Err("图集超过 20MB".to_owned());
    }
    let header = fs::read(&canonical_atlas).map_err(|error| format!("无法读取图集：{error}"))?;
    let (width, height) = image_dimensions(&header).ok_or_else(|| "无法识别图集尺寸".to_owned())?;
    let expected_width = ATLAS_WIDTH * scale;
    let expected_height = ATLAS_HEIGHT * scale;
    if (width, height) != (expected_width, expected_height) {
        return Err(format!(
            "图集必须是 {expected_width}×{expected_height}，实际为 {width}×{height}"
        ));
    }
    Ok(canonical_atlas)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() >= 24 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" {
        return Some((
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
        ));
    }
    if bytes.len() < 30 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => Some((
            1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]),
            1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]),
        )),
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => Some((
            1 + u32::from(bytes[21]) + ((u32::from(bytes[22]) & 0x3f) << 8),
            1 + (u32::from(bytes[22]) >> 6)
                + (u32::from(bytes[23]) << 2)
                + ((u32::from(bytes[24]) & 0x0f) << 10),
        )),
        b"VP8 " if bytes.len() >= 30 && bytes[23..26] == [0x9d, 0x01, 0x2a] => Some((
            u32::from(u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3fff),
            u32::from(u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3fff),
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(hires: Option<&str>) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("fixture directory");
        for (name, scale) in [("standard.png", 1_u32), ("hires.png", 2)] {
            let mut header = vec![0_u8; 24];
            header[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
            header[16..20].copy_from_slice(&(ATLAS_WIDTH * scale).to_be_bytes());
            header[20..24].copy_from_slice(&(ATLAS_HEIGHT * scale).to_be_bytes());
            fs::write(dir.path().join(name), header).expect("test header");
        }
        let manifest = serde_json::json!({"id":"AllBuy", "displayName":"鳌拜", "spriteVersionNumber":2,
            "spritesheetPath":"standard.png", "spritesheet2xPath":hires});
        fs::write(dir.path().join("pet.json"), manifest.to_string()).expect("test manifest");
        dir
    }

    #[test]
    fn accepts_optional_hidpi_and_legacy_skins() {
        let high = fixture(Some("hires.png"));
        let (skin, warning) = validate_skin(high.path()).expect("valid high density skin");
        assert!(skin.atlas2x_path.is_some());
        assert!(warning.is_none());
        let old = fixture(None);
        let (skin, warning) = validate_skin(old.path()).expect("old skin");
        assert!(skin.atlas2x_path.is_none());
        assert!(warning.is_none());
    }

    #[test]
    fn unsafe_missing_or_wrong_size_hidpi_falls_back_without_authorizing_it() {
        for path in [
            "../outside.png",
            "/tmp/outside.png",
            "missing.png",
            "standard.png",
            "bad.txt",
        ] {
            let dir = fixture(Some(path));
            let (skin, warning) = validate_skin(dir.path()).expect("standard skin retained");
            assert!(skin.atlas2x_path.is_none(), "{path}");
            assert!(warning.is_some(), "{path}");
            assert!(skin.atlas_path.ends_with("standard.png"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn hidpi_symlink_cannot_escape_skin_directory() {
        let dir = fixture(Some("escape.png"));
        let outside = fixture(None);
        std::os::unix::fs::symlink(
            outside.path().join("hires.png"),
            dir.path().join("escape.png"),
        )
        .expect("test symlink");
        let (skin, warning) = validate_skin(dir.path()).expect("standard retained");
        assert!(skin.atlas2x_path.is_none());
        assert!(warning.is_some());
    }
    #[test]
    fn reads_lossless_webp_dimensions() {
        let mut bytes = vec![0; 30];
        bytes[..4].copy_from_slice(b"RIFF");
        bytes[8..12].copy_from_slice(b"WEBP");
        bytes[12..16].copy_from_slice(b"VP8L");
        bytes[20..25].copy_from_slice(&[0x2f, 0xff, 0xc5, 0x3b, 0x12]);
        assert_eq!(image_dimensions(&bytes), Some((1536, 2288)));
    }
    #[test]
    fn rejects_unsafe_ids() {
        assert!(!valid_id("../cat"));
        assert!(valid_id("corgi-2"));
        assert!(valid_id("AllBuy"));
    }
}
