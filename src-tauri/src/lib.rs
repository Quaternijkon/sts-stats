use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const MAX_FILE: u64 = 32 * 1024 * 1024;
const MAX_DATASET: u64 = 512 * 1024 * 1024;
const MAX_FILES: usize = 50_000;
struct Storage {
    root: PathBuf,
    authorized: Mutex<HashSet<PathBuf>>,
    writes: Mutex<()>,
    dropped: Mutex<Vec<PathBuf>>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveFile {
    name: String,
    path: String,
    text: String,
    modified_at: u64,
}
#[derive(Serialize)]
struct Selection {
    directory: String,
    files: Vec<SaveFile>,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn game_dir(storage: &Storage, game: &str) -> Result<PathBuf, String> {
    if !matches!(game, "sts1" | "sts2") {
        return Err("Invalid game".into());
    }
    Ok(storage.root.join(game))
}
fn read_text(path: &Path, max: u64) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(error)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > max {
        return Err("Unsupported file or size limit exceeded".into());
    }
    let bytes = fs::read(path).map_err(error)?;
    if bytes.len() as u64 > max {
        return Err("Size limit exceeded".into());
    }
    String::from_utf8(bytes).map_err(error)
}
fn is_save(path: &Path) -> bool {
    path.extension()
        .is_some_and(|v| v.eq_ignore_ascii_case("run"))
        || path
            .file_name()
            .is_some_and(|v| v.eq_ignore_ascii_case("progress.save"))
}
fn read_save(path: &Path) -> Result<SaveFile, String> {
    if !is_save(path) {
        return Err("Only .run / progress.save are supported".into());
    }
    let before = fs::metadata(path).map_err(error)?;
    let stamp = before.modified().map_err(error)?;
    let text = read_text(path, MAX_FILE)?;
    let after = fs::metadata(path).map_err(error)?;
    if after.len() != before.len() || after.modified().map_err(error)? != stamp {
        return Err("Save changed during reading; retry later".into());
    }
    Ok(SaveFile {
        name: path
            .file_name()
            .ok_or("Missing filename")?
            .to_string_lossy()
            .into(),
        path: path.to_string_lossy().into(),
        text,
        modified_at: stamp
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(error)?
            .as_millis() as u64,
    })
}
fn resolve_source(root: &Path) -> Result<PathBuf, String> {
    let canonical = root.canonicalize().map_err(error)?;
    let root = canonical.as_path();
    if root.file_name().is_some_and(|name| name == "saves") || root.join("progress.save").is_file()
    {
        return Ok(root.to_path_buf());
    }
    let profile_file = root.join("profile.save");
    if profile_file.exists() {
        let profile: Value =
            serde_json::from_str(&read_text(&profile_file, 1024 * 1024)?).map_err(error)?;
        let id = profile
            .get("last_profile_id")
            .and_then(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| value.as_u64().map(|id| id.to_string()))
            })
            .ok_or("Invalid current Profile; choose a profile/saves folder")?;
        if id.is_empty()
            || id.len() > 128
            || id.contains(['/', '\\'])
            || matches!(id.as_str(), "." | "..")
        {
            return Err("Invalid current Profile".into());
        }
        let name = if id.starts_with("profile") {
            id
        } else {
            format!("profile{id}")
        };
        let target = root
            .join(name)
            .join("saves")
            .canonicalize()
            .map_err(error)?;
        if !target.starts_with(root) || !target.is_dir() {
            return Err("Current Profile unavailable".into());
        }
        return Ok(target);
    }
    let mut folders = Vec::new();
    for entry in fs::read_dir(root).map_err(error)? {
        let entry = entry.map_err(error)?;
        if entry.file_type().map_err(error)?.is_dir()
            && !entry.file_name().to_string_lossy().starts_with('.')
        {
            folders.push(entry.path());
        }
    }
    let profile_roots: Vec<_> = folders
        .iter()
        .filter(|path| path.join("profile.save").is_file())
        .collect();
    if profile_roots.len() > 1 {
        return Err("Multiple accounts or Profiles; choose a single profile/saves folder".into());
    }
    if let Some(profile) = profile_roots.first() {
        return resolve_source(profile);
    }
    let saves: Vec<_> = folders
        .into_iter()
        .filter_map(|path| {
            if path.file_name().is_some_and(|name| name == "saves") {
                Some(path)
            } else {
                let saves = path.join("saves");
                fs::symlink_metadata(&saves)
                    .ok()
                    .filter(|meta| meta.is_dir() && !meta.file_type().is_symlink())
                    .map(|_| saves)
            }
        })
        .collect();
    if saves.len() > 1 {
        return Err("Multiple save sources; choose a single profile/saves folder".into());
    }
    Ok(saves
        .into_iter()
        .next()
        .unwrap_or_else(|| root.to_path_buf()))
}
fn scan(root: &Path) -> Result<Vec<SaveFile>, String> {
    if !root.is_dir() {
        return Err("Source directory unavailable".into());
    }
    let mut paths = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
    {
        let entry = entry.map_err(error)?;
        if entry.file_type().is_file() && is_save(entry.path()) {
            paths.push(entry.into_path());
        }
        if paths.len() > MAX_FILES {
            return Err("Too many save files".into());
        }
    }
    if paths
        .iter()
        .filter(|p| {
            p.file_name()
                .is_some_and(|v| v.eq_ignore_ascii_case("progress.save"))
        })
        .count()
        > 1
    {
        return Err("发现多个 progress.save，请选择单一账号或 Profile 的存档文件夹".into());
    }
    paths.sort();
    let mut total = 0usize;
    let mut files = Vec::new();
    for path in paths {
        let file = read_save(&path)?;
        total += file.text.len();
        if total as u64 > MAX_DATASET {
            return Err("Save selection exceeds 512 MiB".into());
        }
        files.push(file);
    }
    Ok(files)
}
fn fingerprint(root: &Path) -> Result<String, String> {
    let mut stamps = Vec::new();
    if !root.is_dir() {
        return Err("Source directory unavailable".into());
    }
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
    {
        let entry = entry.map_err(error)?;
        if entry.file_type().is_file() && is_save(entry.path()) {
            let meta = entry.metadata().map_err(error)?;
            stamps.push(format!(
                "{}|{}|{:?}",
                entry.path().display(),
                meta.len(),
                meta.modified().map_err(error)?
            ));
        }
        if stamps.len() > MAX_FILES {
            return Err("Too many save files".into());
        }
    }
    stamps.sort();
    Ok(hash(stamps.join("\n").as_bytes()))
}
fn authorized_path(app: &tauri::AppHandle, directory: String) -> Result<PathBuf, String> {
    let path = PathBuf::from(directory).canonicalize().map_err(error)?;
    if !app
        .state::<Storage>()
        .authorized
        .lock()
        .map_err(error)?
        .contains(&path)
    {
        return Err("请先通过目录选择器授权该文件夹".into());
    }
    Ok(path)
}
#[tauri::command]
async fn snapshot_directory(app: tauri::AppHandle, directory: String) -> Result<String, String> {
    background(move || fingerprint(&authorized_path(&app, directory)?)).await
}
#[tauri::command]
async fn load_source_dataset(
    app: tauri::AppHandle,
    game: String,
    source: String,
) -> Result<Option<Value>, String> {
    background(move || {
        let path = game_dir(&app.state::<Storage>(), &game)?
            .join("archives")
            .join(hash(source.as_bytes()))
            .join("dataset.json");
        if !path.exists() {
            return Ok(None);
        }
        serde_json::from_str(&read_text(&path, MAX_DATASET)?)
            .map(Some)
            .map_err(error)
    })
    .await
}
fn atomic(path: &Path, text: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid storage path")?;
    fs::create_dir_all(parent).map_err(error)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    file.write_all(text.as_bytes()).map_err(error)?;
    file.as_file().sync_all().map_err(error)?;
    file.persist(path).map_err(error)?;
    Ok(())
}
fn commit_dataset(root: &Path, archive: &Path, text: &str) -> Result<(), String> {
    let checkpoint = archive.join("dataset.json");
    let previous = if checkpoint.exists() {
        Some(read_text(&checkpoint, MAX_DATASET)?)
    } else {
        None
    };
    atomic(&checkpoint, text)?;
    if let Err(failure) = atomic(&root.join("dataset.json"), text) {
        let rollback = match previous {
            Some(previous) => atomic(&checkpoint, &previous),
            None => fs::remove_file(&checkpoint).map_err(error),
        };
        return Err(match rollback {
            Ok(()) => failure,
            Err(rollback) => format!("{failure}; archive rollback failed: {rollback}"),
        });
    }
    Ok(())
}
async fn background<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(error)?
}
fn directory_selection(storage: &Storage, directory: PathBuf) -> Result<Selection, String> {
    if directory.starts_with(&storage.root) || storage.root.starts_with(&directory) {
        return Err("Source and application storage must not overlap".into());
    }
    let directory = resolve_source(&directory)?;
    let files = scan(&directory)?;
    let mut allowed = storage.authorized.lock().map_err(error)?;
    allowed.insert(directory.clone());
    atomic(
        &storage.root.join("authorized.json"),
        &serde_json::to_string(&*allowed).map_err(error)?,
    )?;
    Ok(Selection {
        directory: directory.to_string_lossy().into(),
        files,
    })
}
#[tauri::command]
async fn take_dropped_sources(app: tauri::AppHandle) -> Result<Option<Selection>, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let mut paths = std::mem::take(&mut *storage.dropped.lock().map_err(error)?);
        if paths.is_empty() {
            return Ok(None);
        }
        if paths.len() > MAX_FILES {
            return Err("Too many dropped files".into());
        }
        if paths.len() == 1 && paths[0].is_dir() {
            return directory_selection(&storage, paths.remove(0).canonicalize().map_err(error)?)
                .map(Some);
        }
        if paths.iter().any(|path| path.is_dir()) {
            return Err("Drop a single save directory".into());
        }
        paths.sort();
        let source = format!(
            "files:\n{}",
            paths
                .iter()
                .map(|path| path.to_string_lossy())
                .collect::<Vec<_>>()
                .join("\n")
        );
        let files = paths
            .iter()
            .map(|path| read_save(path))
            .collect::<Result<Vec<_>, _>>()?;
        if files.iter().map(|file| file.text.len()).sum::<usize>() as u64 > MAX_DATASET {
            return Err("Dropped saves exceed 512 MiB".into());
        }
        Ok(Some(Selection {
            directory: source,
            files,
        }))
    })
    .await
}
#[tauri::command]
async fn choose_directory(app: tauri::AppHandle) -> Result<Option<Selection>, String> {
    background(move || {
        let Some(chosen) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let directory = chosen
            .into_path()
            .map_err(error)?
            .canonicalize()
            .map_err(error)?;
        directory_selection(&app.state::<Storage>(), directory).map(Some)
    })
    .await
}
#[tauri::command]
async fn choose_files(app: tauri::AppHandle) -> Result<Vec<SaveFile>, String> {
    background(move || {
        let paths = app
            .dialog()
            .file()
            .add_filter("Game saves", &["run", "save"])
            .blocking_pick_files()
            .unwrap_or_default();
        let files = paths
            .into_iter()
            .map(|p| read_save(&p.into_path().map_err(error)?))
            .collect::<Result<Vec<_>, _>>()?;
        if files.len() > MAX_FILES
            || files.iter().map(|f| f.text.len()).sum::<usize>() as u64 > MAX_DATASET
        {
            return Err("Save selection too large".into());
        }
        Ok(files)
    })
    .await
}
#[tauri::command]
async fn scan_directory(app: tauri::AppHandle, directory: String) -> Result<Vec<SaveFile>, String> {
    background(move || {
        let path = PathBuf::from(directory).canonicalize().map_err(error)?;
        if !app
            .state::<Storage>()
            .authorized
            .lock()
            .map_err(error)?
            .contains(&path)
        {
            return Err("请先通过目录选择器授权该文件夹".into());
        }
        scan(&path)
    })
    .await
}
#[tauri::command]
async fn load_dataset(app: tauri::AppHandle, game: String) -> Result<Option<Value>, String> {
    background(move || {
        let path = game_dir(&app.state::<Storage>(), &game)?.join("dataset.json");
        if !path.exists() {
            return Ok(None);
        }
        serde_json::from_str(&read_text(&path, MAX_DATASET)?)
            .map(Some)
            .map_err(error)
    })
    .await
}
#[tauri::command]
async fn save_dataset(
    app: tauri::AppHandle,
    game: String,
    text: String,
    files: Vec<SaveFile>,
) -> Result<(), String> {
    background(move || {
        if text.len() as u64 > MAX_DATASET {
            return Err("Dataset exceeds 512 MiB".into());
        }
        let value: Value = serde_json::from_str(&text).map_err(error)?;
        let runs = value
            .get("runs")
            .and_then(Value::as_array)
            .ok_or("Invalid dataset")?;
        let source = value
            .get("source")
            .and_then(Value::as_str)
            .ok_or("Invalid source")?;
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?;
        // Immutable accepted revisions live in app storage, never in source folders.
        let archive = root.join("archives").join(hash(source.as_bytes()));
        if files.len() > MAX_FILES
            || files.iter().map(|f| f.text.len()).sum::<usize>() as u64 > MAX_DATASET
        {
            return Err("Archive selection too large".into());
        }
        for file in files {
            if file.text.len() as u64 > MAX_FILE || !is_save(Path::new(&file.name)) {
                return Err("Invalid archive save".into());
            }
            let suffix = if file.name.to_lowercase().ends_with(".run") {
                "run"
            } else {
                "save"
            };
            let path =
                archive
                    .join("blobs")
                    .join(format!("{}.{}", hash(file.text.as_bytes()), suffix));
            if !path.exists() {
                atomic(&path, &file.text)?;
            }
        }
        for run in runs {
            let revision = serde_json::to_string(run).map_err(error)?;
            let path = archive
                .join("runs")
                .join(format!("{}.json", hash(revision.as_bytes())));
            if !path.exists() {
                atomic(&path, &revision)?;
            }
        }
        commit_dataset(&root, &archive, &text)
    })
    .await
}
#[tauri::command]
async fn import_dataset(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    background(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Dataset", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        serde_json::from_str(&read_text(&file.into_path().map_err(error)?, MAX_DATASET)?)
            .map(Some)
            .map_err(error)
    })
    .await
}
#[tauri::command]
async fn export_text(app: tauri::AppHandle, name: String, text: String) -> Result<bool, String> {
    background(move || {
        if text.len() as u64 > MAX_DATASET {
            return Err("Export too large".into());
        }
        let name = Path::new(&name)
            .file_name()
            .ok_or("Invalid filename")?
            .to_string_lossy();
        let Some(file) = app.dialog().file().set_file_name(name).blocking_save_file() else {
            return Ok(false);
        };
        let path = file.into_path().map_err(error)?;
        // Exports cannot overwrite a live game save.
        if is_save(&path)
            || path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("save"))
        {
            return Err("不能覆盖原始游戏存档".into());
        }
        let parent = path
            .parent()
            .ok_or("Invalid export path")?
            .canonicalize()
            .map_err(error)?;
        if app
            .state::<Storage>()
            .authorized
            .lock()
            .map_err(error)?
            .iter()
            .any(|source| parent.starts_with(source))
        {
            return Err("Exports must be saved outside the original game-save directory".into());
        }
        atomic(&path, &text)?;
        Ok(true)
    })
    .await
}
#[tauri::command]
async fn load_preferences(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    background(move || {
        let path = app.state::<Storage>().root.join("preferences.json");
        if !path.exists() {
            return Ok(None);
        }
        serde_json::from_str(&read_text(&path, 1024 * 1024)?)
            .map(Some)
            .map_err(error)
    })
    .await
}
#[tauri::command]
async fn save_preferences(app: tauri::AppHandle, text: String) -> Result<(), String> {
    background(move || {
        if text.len() > 1024 * 1024 {
            return Err("Preferences too large".into());
        }
        let _: Value = serde_json::from_str(&text).map_err(error)?;
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        atomic(&storage.root.join("preferences.json"), &text)
    })
    .await
}
#[tauri::command]
fn data_directory(storage: State<'_, Storage>) -> String {
    storage.root.to_string_lossy().into()
}
#[tauri::command]
async fn clear_dataset(app: tauri::AppHandle, game: String) -> Result<(), String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?;
        if root.exists() {
            fs::remove_dir_all(root).map_err(error)?;
        }
        Ok(())
    })
    .await
}
pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Some(storage) = window.app_handle().try_state::<Storage>() {
                    if let Ok(mut dropped) = storage.dropped.lock() {
                        *dropped = paths.clone();
                    }
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            fs::create_dir_all(&root)?;
            let authorized = fs::read_to_string(root.join("authorized.json"))
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or_default();
            app.manage(Storage {
                root,
                authorized: Mutex::new(authorized),
                writes: Mutex::new(()),
                dropped: Mutex::new(Vec::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_dropped_sources,
            snapshot_directory,
            load_source_dataset,
            choose_directory,
            choose_files,
            scan_directory,
            load_dataset,
            save_dataset,
            import_dataset,
            export_text,
            load_preferences,
            save_preferences,
            data_directory,
            clear_dataset
        ])
        .run(tauri::generate_context!())
        .expect("Cannot start STS2Stats");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profiles_resolve_without_mixing_accounts() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("profile1/saves")).unwrap();
        fs::create_dir_all(root.path().join("profile2/saves")).unwrap();
        assert!(resolve_source(root.path()).is_err());
        fs::write(root.path().join("profile.save"), "{\"last_profile_id\":2}").unwrap();
        assert_eq!(
            resolve_source(root.path()).unwrap(),
            root.path().join("profile2/saves").canonicalize().unwrap()
        );
        fs::write(
            root.path().join("profile.save"),
            "{\"last_profile_id\":\"../other\"}",
        )
        .unwrap();
        assert!(resolve_source(root.path()).is_err());
    }
    #[test]
    fn saves_are_read_only_and_multiple_profiles_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.run");
        fs::write(&path, "{\"win\":true}").unwrap();
        assert_eq!(scan(dir.path()).unwrap().len(), 1);
        assert_eq!(fs::read_to_string(path).unwrap(), "{\"win\":true}");
        fs::write(dir.path().join("progress.save"), "{}").unwrap();
        fs::create_dir(dir.path().join("profile2")).unwrap();
        fs::write(dir.path().join("profile2/progress.save"), "{}").unwrap();
        assert!(scan(dir.path()).is_err());
    }
    #[test]
    fn failed_commit_preserves_source_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("archives/source");
        atomic(&archive.join("dataset.json"), "old").unwrap();
        fs::create_dir(dir.path().join("dataset.json")).unwrap();
        assert!(commit_dataset(dir.path(), &archive, "new").is_err());
        assert_eq!(
            fs::read_to_string(archive.join("dataset.json")).unwrap(),
            "old"
        );
    }
    #[test]
    fn atomic_replace_and_game_paths() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dataset.json");
        atomic(&path, "one").unwrap();
        atomic(&path, "two").unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "two");
        let s = Storage {
            root: dir.path().into(),
            authorized: Mutex::default(),
            writes: Mutex::default(),
            dropped: Mutex::default(),
        };
        assert!(game_dir(&s, "../../anything").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn scanner_does_not_follow_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let save = outside.path().join("secret.run");
        fs::write(&save, "{}").unwrap();
        std::os::unix::fs::symlink(save, root.path().join("link.run")).unwrap();
        assert!(scan(root.path()).unwrap().is_empty());
    }
}
