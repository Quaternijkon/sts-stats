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
    source: String,
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
    let path = storage.root.join(game);
    confined_storage_path(&storage.root, &path)?;
    Ok(path)
}
fn confined_storage_path(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path.strip_prefix(root).map_err(error)?;
    let mut current = root.to_path_buf();
    for part in relative.components() {
        current.push(part.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("应用数据目录不能包含符号链接".into());
            }
            Ok(_) => {}
            Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => {}
            Err(failure) => return Err(error(failure)),
        }
    }
    Ok(())
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
fn file_stamp(meta: &fs::Metadata) -> Result<String, String> {
    let stamp = format!(
        "{}|{:?}|{:?}",
        meta.len(),
        meta.modified().map_err(error)?,
        meta.created().ok()
    );
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!("{stamp}|{}|{}", meta.dev(), meta.ino())
    };
    #[cfg(not(unix))]
    let identity = stamp;
    Ok(identity)
}
fn read_save(path: &Path) -> Result<SaveFile, String> {
    if !is_save(path) {
        return Err("Only .run / progress.save are supported".into());
    }
    let before = fs::metadata(path).map_err(error)?;
    let stamp = before.modified().map_err(error)?;
    let text = read_text(path, MAX_FILE)?;
    let after = fs::metadata(path).map_err(error)?;
    if file_stamp(&after)? != file_stamp(&before)? {
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
            stamps.push(format!("{}|{}", entry.path().display(), file_stamp(&meta)?));
        }
        if stamps.len() > MAX_FILES {
            return Err("Too many save files".into());
        }
    }
    stamps.sort();
    Ok(hash(
        format!("{}\n{}", root.display(), stamps.join("\n")).as_bytes(),
    ))
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
    background(move || fingerprint(&resolve_source(&authorized_path(&app, directory)?)?)).await
}
#[tauri::command]
async fn resolve_directory(app: tauri::AppHandle, directory: String) -> Result<String, String> {
    background(move || {
        resolve_source(&authorized_path(&app, directory)?)
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
}
#[tauri::command]
async fn load_source_dataset(
    app: tauri::AppHandle,
    game: String,
    source: String,
) -> Result<Option<Value>, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let path = game_dir(&storage, &game)?
            .join("archives")
            .join(hash(source.as_bytes()))
            .join("dataset.json");
        confined_storage_path(&storage.root, &path)?;
        if !path.exists() {
            return Ok(None);
        }
        serde_json::from_str(&read_text(&path, MAX_DATASET)?)
            .map(Some)
            .map_err(error)
    })
    .await
}
fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid storage path")?;
    fs::create_dir_all(parent).map_err(error)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    file.write_all(bytes).map_err(error)?;
    file.as_file().sync_all().map_err(error)?;
    file.persist(path).map_err(error)?;
    Ok(())
}
fn atomic(path: &Path, text: &str) -> Result<(), String> {
    atomic_bytes(path, text.as_bytes())
}
#[derive(Default)]
struct StagedFiles {
    paths: Vec<PathBuf>,
    committed: bool,
}
impl StagedFiles {
    fn put(&mut self, path: PathBuf, text: &str) -> Result<(), String> {
        if path.exists() {
            if read_text(&path, MAX_DATASET)? != text {
                return Err("本地归档校验失败".into());
            }
        } else {
            atomic(&path, text)?;
            self.paths.push(path);
        }
        Ok(())
    }
}
impl Drop for StagedFiles {
    fn drop(&mut self) {
        if !self.committed {
            for path in &self.paths {
                let _ = fs::remove_file(path);
            }
        }
    }
}
// Run history is retained; redundant progress snapshots have the native eight-version limit.
fn prune_progress(archive: &Path, current: &Value) {
    let retained: HashSet<String> = current
        .get("manifest")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|manifest| manifest.iter())
        .filter(|(path, _)| {
            Path::new(path)
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("progress.save"))
        })
        .filter_map(|(_, digest)| digest.as_str())
        .map(|digest| format!("{}.save", digest.trim_end_matches(".save")))
        .take(8)
        .collect();
    let Ok(entries) = fs::read_dir(archive.join("blobs")) else {
        return;
    };
    let mut versions: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|suffix| suffix == "save")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();
    versions.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let mut kept = retained.len();
    for (path, _) in versions {
        if path
            .file_name()
            .is_some_and(|name| retained.contains(name.to_string_lossy().as_ref()))
        {
            continue;
        }
        if kept < 8 {
            kept += 1;
        } else {
            let _ = fs::remove_file(path);
        }
    }
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
    let source = resolve_source(&directory)?;
    if source.starts_with(&storage.root) || storage.root.starts_with(&source) {
        return Err("Source and application storage must not overlap".into());
    }
    let before = fingerprint(&source)?;
    let files = scan(&source)?;
    if resolve_source(&directory)? != source || fingerprint(&source)? != before {
        return Err("读取期间存档发生变化，请稍后重试。原有数据保持不变。".into());
    }
    let mut allowed = storage.authorized.lock().map_err(error)?;
    let mut next = allowed.clone();
    next.insert(directory.clone());
    atomic(
        &storage.root.join("authorized.json"),
        &serde_json::to_string(&next).map_err(error)?,
    )?;
    *allowed = next;
    Ok(Selection {
        directory: directory.to_string_lossy().into(),
        source: source.to_string_lossy().into(),
        files,
    })
}
fn selected_files(storage: &Storage, paths: Vec<PathBuf>) -> Result<Vec<SaveFile>, String> {
    if paths.len() > MAX_FILES {
        return Err("Too many save files".into());
    }
    let mut paths = paths
        .into_iter()
        .map(|path| path.canonicalize().map_err(error))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();
    paths.dedup();
    let mut files = Vec::new();
    let mut total = 0usize;
    for path in paths {
        if path.starts_with(&storage.root) {
            return Err("Source and application storage must not overlap".into());
        }
        let file = read_save(&path)?;
        total += file.text.len();
        if total as u64 > MAX_DATASET {
            return Err("Save selection exceeds 512 MiB".into());
        }
        files.push(file);
    }
    Ok(files)
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
        let files = selected_files(&storage, paths)?;
        let source = format!(
            "files:\n{}",
            files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        );
        Ok(Some(Selection {
            directory: source.clone(),
            source,
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
        let paths = paths
            .into_iter()
            .map(|path| path.into_path().map_err(error))
            .collect::<Result<Vec<_>, _>>()?;
        selected_files(&app.state::<Storage>(), paths)
    })
    .await
}
#[tauri::command]
async fn scan_directory(app: tauri::AppHandle, directory: String) -> Result<Vec<SaveFile>, String> {
    background(move || {
        let directory = authorized_path(&app, directory)?;
        let source = resolve_source(&directory)?;
        let before = fingerprint(&source)?;
        let files = scan(&source)?;
        if resolve_source(&directory)? != source || fingerprint(&source)? != before {
            return Err("读取期间存档发生变化，请稍后重试。原有数据保持不变。".into());
        }
        Ok(files)
    })
    .await
}
#[tauri::command]
async fn load_dataset(app: tauri::AppHandle, game: String) -> Result<Option<Value>, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let path = game_dir(&storage, &game)?.join("dataset.json");
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
        if runs.iter().any(|run| {
            run.get("gameVersion")
                .and_then(Value::as_str)
                .is_some_and(|version| version != game)
        }) || (game == "sts1"
            && value
                .get("progress")
                .is_some_and(|progress| !progress.is_null()))
        {
            return Err("数据属于另一个游戏，请选择对应游戏".into());
        }
        let source = value
            .get("source")
            .and_then(Value::as_str)
            .ok_or("Invalid source")?;
        let storage = app.state::<Storage>();
        let _lock = storage.writes.lock().map_err(error)?;
        let root = game_dir(&storage, &game)?;
        // Immutable accepted revisions live in app storage, never in source folders.
        let archive = root.join("archives").join(hash(source.as_bytes()));
        confined_storage_path(&storage.root, &archive)?;
        confined_storage_path(&storage.root, &archive.join("blobs"))?;
        confined_storage_path(&storage.root, &archive.join("runs"))?;
        if files.len() > MAX_FILES
            || files.iter().map(|f| f.text.len()).sum::<usize>() as u64 > MAX_DATASET
        {
            return Err("Archive selection too large".into());
        }
        let mut staged = StagedFiles::default();
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
            staged.put(path, &file.text)?;
        }
        for run in runs {
            let revision = serde_json::to_string(run).map_err(error)?;
            let path = archive
                .join("runs")
                .join(format!("{}.json", hash(revision.as_bytes())));
            staged.put(path, &revision)?;
        }
        if let Err(failure) = commit_dataset(&root, &archive, &text) {
            // Preserve blobs if the filesystem also refused checkpoint rollback.
            staged.committed = failure.contains("archive rollback failed:");
            return Err(failure);
        }
        staged.committed = true;
        prune_progress(&archive, &value);
        Ok(())
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
fn export_bytes(app: &tauri::AppHandle, name: &str, bytes: &[u8]) -> Result<bool, String> {
    if bytes.len() as u64 > MAX_DATASET {
        return Err("Export too large".into());
    }
    let name = Path::new(name)
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
    atomic_bytes(&path, bytes)?;
    Ok(true)
}
#[tauri::command]
async fn export_text(app: tauri::AppHandle, name: String, text: String) -> Result<bool, String> {
    background(move || export_bytes(&app, &name, text.as_bytes())).await
}
#[tauri::command]
async fn export_binary(app: tauri::AppHandle, name: String, data: Vec<u8>) -> Result<bool, String> {
    background(move || export_bytes(&app, &name, &data)).await
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
async fn open_data_directory(app: tauri::AppHandle) -> Result<(), String> {
    background(move || {
        let storage = app.state::<Storage>();
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("open");
        #[cfg(target_os = "windows")]
        let mut command = std::process::Command::new("explorer.exe");
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        return Err("Unsupported desktop platform".into());
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let status = command.arg(&storage.root).status().map_err(error)?;
            // Explorer may return a nonzero code after handing off to its existing process.
            if !status.success() && cfg!(target_os = "macos") {
                return Err("无法打开应用数据文件夹".into());
            }
            Ok(())
        }
    })
    .await
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
            let root = root.canonicalize()?;
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
            resolve_directory,
            load_source_dataset,
            choose_directory,
            choose_files,
            scan_directory,
            load_dataset,
            save_dataset,
            import_dataset,
            export_text,
            export_binary,
            load_preferences,
            save_preferences,
            data_directory,
            open_data_directory,
            clear_dataset
        ])
        .run(tauri::generate_context!())
        .expect("Cannot start STS2Stats");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_account_root_remains_authorized_when_current_profile_changes() {
        let app = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        fs::create_dir_all(source.path().join("profile1/saves")).unwrap();
        fs::create_dir_all(source.path().join("profile2/saves")).unwrap();
        fs::write(source.path().join("profile1/saves/a.run"), "{}").unwrap();
        fs::write(source.path().join("profile2/saves/b.run"), "{}").unwrap();
        fs::write(
            source.path().join("profile.save"),
            "{\"last_profile_id\":1}",
        )
        .unwrap();
        let storage = Storage {
            root: app.path().canonicalize().unwrap(),
            authorized: Mutex::default(),
            writes: Mutex::default(),
            dropped: Mutex::default(),
        };
        let root = source.path().canonicalize().unwrap();
        let first = directory_selection(&storage, root.clone()).unwrap();
        assert_eq!(PathBuf::from(first.directory), root);
        assert!(
            first.source.ends_with("profile1/saves") || first.source.ends_with("profile1\\saves")
        );
        fs::write(
            source.path().join("profile.save"),
            "{\"last_profile_id\":2}",
        )
        .unwrap();
        let next = resolve_source(&root).unwrap();
        assert!(storage.authorized.lock().unwrap().contains(&root));
        assert_eq!(scan(&next).unwrap()[0].name, "b.run");
    }
    #[test]
    fn rejected_transactions_remove_new_blobs_and_verify_existing_blobs() {
        let dir = tempfile::tempdir().unwrap();
        let accepted = dir.path().join("accepted.run");
        let staged_path = dir.path().join("staged.run");
        atomic(&accepted, "old").unwrap();
        {
            let mut staged = StagedFiles::default();
            staged.put(staged_path.clone(), "new").unwrap();
            assert!(staged.put(accepted.clone(), "corrupted").is_err());
        }
        assert!(!staged_path.exists());
        assert_eq!(read_text(&accepted, MAX_FILE).unwrap(), "old");
    }
    #[test]
    fn progress_archives_are_bounded_and_current_revision_is_retained() {
        let dir = tempfile::tempdir().unwrap();
        for revision in 0..12 {
            atomic(
                &dir.path().join("blobs").join(format!("{revision}.save")),
                "{}",
            )
            .unwrap();
        }
        let current = serde_json::json!({ "manifest": { "/synthetic/progress.save": "0" } });
        prune_progress(dir.path(), &current);
        assert_eq!(fs::read_dir(dir.path().join("blobs")).unwrap().count(), 8);
        assert!(dir.path().join("blobs/0.save").exists());
    }
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
        std::os::unix::fs::symlink(outside.path(), root.path().join("sts2")).unwrap();
        let storage = Storage {
            root: root.path().into(),
            authorized: Mutex::default(),
            writes: Mutex::default(),
            dropped: Mutex::default(),
        };
        assert!(game_dir(&storage, "sts2").is_err());
    }
}
