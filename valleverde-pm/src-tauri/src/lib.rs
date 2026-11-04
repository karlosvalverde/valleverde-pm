//! Valleverde PM: the desktop shell. It stores the workspace as one JSON file
//! in a folder the user chooses, with daily backups next to it.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const DATA_FILE: &str = "valleverde.json";
const BACKUP_DIR: &str = "backups";
const BACKUP_PREFIX: &str = "valleverde-";
const KEEP_BACKUPS: usize = 30;

/// Remembered between launches, in the app's config folder.
#[derive(Default, Serialize, Deserialize)]
struct Config {
    #[serde(default)]
    data_dir: Option<PathBuf>,
}

/// The folder the user just picked, waiting for them to decide what to do with it.
/// Keeping it here means the page can never ask to write to an arbitrary path.
#[derive(Default)]
struct PendingFolder(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
struct Workspace {
    path: String,
    dir: String,
    content: Option<String>,
    mtime: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderChoice {
    dir: String,
    has_file: bool,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("config.json"))
}

fn read_config(app: &AppHandle) -> Config {
    config_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = config_file(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    write_atomic(&path, &serde_json::to_string_pretty(config).map_err(err)?)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match read_config(app).data_dir {
        Some(dir) => Ok(dir),
        None => app.path().app_data_dir().map_err(err),
    }
}

fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(DATA_FILE))
}

fn mtime_of(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Writes next to the target and renames over it, so a crash never leaves half a file.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, content).map_err(|e| format!("Couldn't write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Couldn't save {}: {e}", path.display()))
}

fn is_date(s: &str) -> bool {
    s.len() == 10
        && s.bytes()
            .enumerate()
            .all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() })
}

/// Copies the data file into backups/ under `name`, then keeps only the newest backups.
fn backup(file: &Path, name: &str, overwrite: bool) -> Result<(), String> {
    if !file.exists() {
        return Ok(());
    }
    let dir = file.parent().unwrap_or(Path::new(".")).join(BACKUP_DIR);
    fs::create_dir_all(&dir).map_err(err)?;
    let target = dir.join(name);
    if target.exists() && !overwrite {
        return Ok(());
    }
    fs::copy(file, &target).map_err(err)?;
    let mut backups: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(BACKUP_PREFIX) && n.ends_with(".json"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort();
    while backups.len() > KEEP_BACKUPS {
        let _ = fs::remove_file(backups.remove(0));
    }
    Ok(())
}

fn workspace(app: &AppHandle) -> Result<Workspace, String> {
    let file = data_file(app)?;
    let content = match fs::read_to_string(&file) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Couldn't read {}: {e}", file.display())),
    };
    Ok(Workspace {
        path: file.display().to_string(),
        dir: file.parent().map(|d| d.display().to_string()).unwrap_or_default(),
        content,
        mtime: mtime_of(&file),
    })
}

fn check_json(content: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(content)
        .map(|_| ())
        .map_err(|e| format!("Refusing to save data that isn't valid JSON: {e}"))
}

#[tauri::command]
fn load_workspace(app: AppHandle) -> Result<Workspace, String> {
    workspace(&app)
}

#[tauri::command]
fn save_workspace(app: AppHandle, content: String, today: String) -> Result<u64, String> {
    check_json(&content)?;
    let file = data_file(&app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    }
    if is_date(&today) {
        // A failed backup shouldn't stop the save itself.
        let _ = backup(&file, &format!("{BACKUP_PREFIX}{today}.json"), false);
    }
    write_atomic(&file, &content)?;
    Ok(mtime_of(&file))
}

#[tauri::command]
fn workspace_mtime(app: AppHandle) -> Result<u64, String> {
    Ok(mtime_of(&data_file(&app)?))
}

#[tauri::command]
async fn choose_folder(
    app: AppHandle,
    pending: State<'_, PendingFolder>,
) -> Result<Option<FolderChoice>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose a folder for your Valleverde data")
        .set_can_create_directories(true);
    if let Ok(dir) = data_dir(&app) {
        if dir.exists() {
            dialog = dialog.set_directory(dir);
        }
    }
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = picked.into_path().map_err(err)?;
    let has_file = dir.join(DATA_FILE).exists();
    *pending.0.lock().map_err(err)? = Some(dir.clone());
    Ok(Some(FolderChoice {
        dir: dir.display().to_string(),
        has_file,
    }))
}

/// mode "open": use the data file already in the picked folder.
/// mode "move": save this window's data into the picked folder (keeping a copy of any file there).
#[tauri::command]
fn use_folder(
    app: AppHandle,
    pending: State<'_, PendingFolder>,
    mode: String,
    content: Option<String>,
    today: String,
) -> Result<Workspace, String> {
    let dir = pending
        .0
        .lock()
        .map_err(err)?
        .take()
        .ok_or_else(|| "Choose a folder first.".to_string())?;
    let file = dir.join(DATA_FILE);
    match mode.as_str() {
        "open" => {
            if !file.exists() {
                return Err("That folder has no Valleverde data file.".into());
            }
        }
        "move" => {
            let content = content.ok_or_else(|| "There was nothing to save.".to_string())?;
            check_json(&content)?;
            let stamp = if is_date(&today) { today } else { "undated".into() };
            backup(&file, &format!("{BACKUP_PREFIX}{stamp}-before-replace.json"), true)?;
            write_atomic(&file, &content)?;
        }
        _ => return Err(format!("Unknown folder mode: {mode}")),
    }
    let mut config = read_config(&app);
    config.data_dir = Some(dir);
    write_config(&app, &config)?;
    workspace(&app)
}

#[tauri::command]
fn reveal_data_file(app: AppHandle) -> Result<(), String> {
    let file = data_file(&app)?;
    let dir = file.parent().map(Path::to_path_buf).unwrap_or_default();
    fs::create_dir_all(&dir).map_err(err)?;
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if file.exists() {
            cmd.arg("-R").arg(&file);
        } else {
            cmd.arg(&dir);
        }
        cmd.spawn().map_err(err)?;
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer");
        if file.exists() {
            cmd.arg(format!("/select,{}", file.display()));
        } else {
            cmd.arg(&dir);
        }
        cmd.spawn().map_err(err)?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(err)?;
    }
    Ok(())
}

/// Only web links and new emails can be opened; anything else is refused.
fn is_openable(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:"))
        && !url.chars().any(|c| c.is_control())
        && url.len() <= 32_000
}

/// Opens a project link in the browser, or a drafted email in the mail app.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !is_openable(&url) {
        return Err("Only web links and email drafts can be opened.".into());
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn().map_err(err)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map_err(err)?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open").arg(&url).spawn().map_err(err)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFolder::default())
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            workspace_mtime,
            choose_folder,
            use_folder,
            reveal_data_file,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running Valleverde PM");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_links_and_emails_open() {
        assert!(is_openable("https://partena.odoo.com/odoo"));
        assert!(is_openable("mailto:ana@partena.be?subject=Hi&body=a%0Ab"));
        assert!(!is_openable("file:///etc/passwd"));
        assert!(!is_openable("/Applications/Calculator.app"));
        assert!(!is_openable("-a Calculator"));
        assert!(!is_openable("https://x.com/\nrm"));
        assert!(!is_openable("https://x.com/\u{0}"));
    }

    #[test]
    fn dates_are_checked() {
        assert!(is_date("2026-11-04"));
        assert!(!is_date("2026-11-4"));
        assert!(!is_date("../../etc"));
    }

    #[test]
    fn backups_are_pruned_and_writes_are_atomic() {
        let dir = std::env::temp_dir().join(format!("vpm-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(DATA_FILE);
        write_atomic(&file, "{}").unwrap();
        for d in 1..=35 {
            backup(&file, &format!("{BACKUP_PREFIX}2026-10-{d:02}.json"), false).unwrap();
        }
        let n = fs::read_dir(dir.join(BACKUP_DIR)).unwrap().count();
        assert_eq!(n, KEEP_BACKUPS);
        assert!(!dir.join(BACKUP_DIR).join("valleverde-2026-10-01.json").exists());
        assert!(!dir.join("valleverde.json.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
