use super::storage_cache::{atomic_copy, summary};
use super::{
    atomic, background, confined_storage_path, error, file_stamp, game_dir, hash, read_text,
    StagedFiles, Storage,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    blob: String,
    name: String,
    id: String,
    versions: Vec<String>,
    #[serde(default)]
    imported_at: f64,
    #[serde(default)]
    modified: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    version: u32,
    #[serde(default)]
    runs: BTreeMap<String, Entry>,
    progress: Option<Entry>,
    #[serde(default)]
    source_digests: BTreeMap<String, String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Source {
    id: String,
    game: String,
    source: String,
    active: bool,
    runs: usize,
    revisions: usize,
    imported_at: f64,
}
struct Location {
    source: Source,
    dataset: Option<PathBuf>,
    index: Option<PathBuf>,
    stamps: Vec<(PathBuf, String)>,
}
impl Location {
    fn verify(&self) -> Result<(), String> {
        for (path, stamp) in &self.stamps {
            if file_stamp(&fs::symlink_metadata(path).map_err(error)?)? != *stamp {
                return Err("旧应用数据已更新，请重新选择迁移来源".into());
            }
        }
        Ok(())
    }
}
pub(super) struct Session {
    token: String,
    sources: BTreeMap<String, Location>,
    directory: tempfile::TempDir,
    staged: BTreeMap<String, PathBuf>,
}
fn selected_stages<'a>(
    session: &'a Session,
    ids: &[String],
) -> Result<Vec<(&'a Location, &'a Path)>, String> {
    let mut selected = BTreeSet::new();
    ids.iter()
        .map(|id| {
            if !selected.insert(id) {
                return Err("迁移来源选择重复".into());
            }
            let location = session.sources.get(id).ok_or("未选择该旧来源")?;
            let path = session.staged.get(id).ok_or("迁移来源尚未暂存")?;
            Ok((location, path.as_path()))
        })
        .collect()
}
#[derive(Serialize)]
pub(super) struct Selection {
    token: String,
    sources: Vec<Source>,
    preferences: Option<Value>,
}

fn read_index(path: &Path) -> Result<Index, String> {
    let value: Index = serde_json::from_str(&read_text(path, u64::MAX)?).map_err(error)?;
    if value.version != 1 {
        return Err("不支持的旧归档版本".into());
    }
    Ok(value)
}
fn infer_source(index: &Index, digest: &str, game: &str) -> String {
    let paths: Vec<_> = index.source_digests.keys().cloned().collect();
    let joined = paths.join("\n");
    if hash(joined.as_bytes()) == digest {
        return joined;
    }
    for path in &paths {
        if hash(path.as_bytes()) == digest {
            return path.clone();
        }
        let mut candidate = path.as_str();
        while let Some(offset) = candidate.rfind(['/', '\\']) {
            candidate = &candidate[..offset];
            if candidate.is_empty() {
                break;
            }
            if paths.iter().all(|path| {
                path.starts_with(&format!("{candidate}/"))
                    || path.starts_with(&format!("{candidate}\\"))
            }) && hash(candidate.as_bytes()) == digest
            {
                return candidate.into();
            }
        }
    }
    // A removed/renamed source is still addressable without inventing its path.
    format!("legacy:{game}:{digest}")
}

pub(super) fn load_archive(root: &Path, game: &str, source: &str) -> Result<Option<Value>, String> {
    let direct = root
        .join("archives")
        .join(hash(source.as_bytes()))
        .join("dataset.json");
    confined_storage_path(root, &direct)?;
    if direct.exists() {
        let value: Value = serde_json::from_str(&read_text(&direct, u64::MAX)?).map_err(error)?;
        if value["source"].as_str() != Some(source) {
            return Err("来源归档与目录不一致".into());
        }
        return Ok(Some(value));
    }
    let native_source = source.strip_prefix("files:\n").unwrap_or(source);
    let digest = hash(native_source.as_bytes());
    let compatible = root.join("archives").join(&digest).join("dataset.json");
    confined_storage_path(root, &compatible)?;
    if compatible.exists() {
        let mut value: Value =
            serde_json::from_str(&read_text(&compatible, u64::MAX)?).map_err(error)?;
        if value["source"].as_str() == Some(native_source) {
            value["source"] = json!(source);
            return Ok(Some(value));
        }
    }
    let alias = root
        .join("archives")
        .join(&digest)
        .join("legacy-source.json");
    confined_storage_path(root, &alias)?;
    if !alias.exists() {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(&read_text(&alias, 1024 * 1024)?).map_err(error)?;
    let legacy_source = format!("legacy:{game}:{digest}");
    if value["source"].as_str() != Some(legacy_source.as_str()) {
        return Err("旧来源映射校验失败".into());
    }
    let path = root
        .join("archives")
        .join(hash(legacy_source.as_bytes()))
        .join("dataset.json");
    confined_storage_path(root, &path)?;
    let mut value: Value = serde_json::from_str(&read_text(&path, u64::MAX)?).map_err(error)?;
    if value["source"].as_str() != Some(legacy_source.as_str()) {
        return Err("旧来源映射校验失败".into());
    }
    value["source"] = json!(source);
    Ok(Some(value))
}
fn describe(root: &Path) -> Result<BTreeMap<String, Location>, String> {
    let roots = if root
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("STS1"))
    {
        vec![("sts1", root.to_path_buf())]
    } else {
        vec![("sts2", root.to_path_buf()), ("sts1", root.join("STS1"))]
    };
    let mut sources = BTreeMap::new();
    for (game, directory) in roots {
        if !directory.exists() {
            continue;
        }
        confined_storage_path(root, &directory)?;
        let dataset_path = directory.join("dataset.json");
        let dataset: Option<Value> = if dataset_path.exists() {
            Some(serde_json::from_str(&read_text(&dataset_path, u64::MAX)?).map_err(error)?)
        } else {
            None
        };
        if let Some(value) = &dataset {
            let data = summary(value)?;
            let source = data["source"].as_str().ok_or("旧数据来源无效")?;
            if !source.is_empty()
                || data["runs"].as_array().is_some_and(|runs| !runs.is_empty())
                || !data["progress"].is_null()
            {
                let id = format!("{game}-{}", hash(source.as_bytes()));
                sources.insert(
                    id.clone(),
                    Location {
                        source: Source {
                            id,
                            game: game.into(),
                            source: source.into(),
                            active: true,
                            runs: data["runs"].as_array().map_or(0, Vec::len),
                            revisions: 0,
                            imported_at: data["importedAt"].as_f64().unwrap_or(0.0),
                        },
                        dataset: Some(dataset_path.clone()),
                        index: None,
                        stamps: vec![(
                            dataset_path.clone(),
                            file_stamp(&fs::symlink_metadata(&dataset_path).map_err(error)?)?,
                        )],
                    },
                );
            }
        }
        let archive = directory.join("save-archive-v1");
        if !archive.exists() {
            continue;
        }
        confined_storage_path(root, &archive)?;
        for entry in fs::read_dir(archive).map_err(error)? {
            let entry = entry.map_err(error)?;
            if !entry.file_type().map_err(error)?.is_dir() {
                continue;
            }
            let digest = entry.file_name().to_string_lossy().into_owned();
            if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                continue;
            }
            let path = entry.path().join("index.json");
            confined_storage_path(root, &path)?;
            let index = read_index(&path)?;
            let id = format!("{game}-{digest}");
            let revisions = index
                .runs
                .values()
                .chain(index.progress.iter())
                .map(|entry| entry.versions.len().max(1))
                .sum();
            let latest = index
                .runs
                .values()
                .chain(index.progress.iter())
                .map(|entry| entry.imported_at)
                .fold(0.0_f64, f64::max);
            let location = sources.entry(id.clone()).or_insert_with(|| Location {
                source: Source {
                    id,
                    game: game.into(),
                    source: infer_source(&index, &digest, game),
                    active: false,
                    runs: index.runs.len(),
                    revisions,
                    imported_at: (latest / 1000.0 - 978307200.0).max(0.0),
                },
                dataset: None,
                index: None,
                stamps: Vec::new(),
            });
            location.source.runs = location.source.runs.max(index.runs.len());
            location.source.revisions = revisions;
            location.stamps.push((
                path.clone(),
                file_stamp(&fs::symlink_metadata(&path).map_err(error)?)?,
            ));
            location.index = Some(path);
        }
    }
    Ok(sources)
}

fn plist_json(value: &plist::Value) -> Result<Value, String> {
    Ok(match value {
        plist::Value::Array(values) => {
            Value::Array(values.iter().map(plist_json).collect::<Result<_, _>>()?)
        }
        plist::Value::Dictionary(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| Ok((key.clone(), plist_json(value)?)))
                .collect::<Result<_, String>>()?,
        ),
        plist::Value::String(value) => json!(value),
        plist::Value::Boolean(value) => json!(value),
        plist::Value::Integer(value) => value
            .as_signed()
            .map_or_else(|| json!(value.as_unsigned()), |value| json!(value)),
        plist::Value::Real(value) => json!(value),
        plist::Value::Date(value) => json!(value.to_xml_format()),
        plist::Value::Data(value) => serde_json::from_slice(value).map_err(error)?,
        _ => Value::Null,
    })
}
fn read_preferences(path: &Path) -> Result<Value, String> {
    let text = fs::read(path).map_err(error)?;
    let value = plist::Value::from_reader(Cursor::new(text)).map_err(error)?;
    let dictionary = value.as_dictionary().ok_or("旧偏好文件不是 plist 字典")?;
    let mut result = serde_json::Map::new();
    for key in ["appearance", "minimumSample", "selectedGame"] {
        if let Some(value) = dictionary.get(key) {
            result.insert(key.into(), plist_json(value)?);
        }
    }
    for prefix in ["", "sts1."] {
        for key in [
            "favorites",
            "analysisFilter",
            "objectFilter",
            "soloRecordFilter",
            "coopRecordFilter",
            "autoSyncEnabled",
            "lastSyncedAt",
            "savedQueries",
        ] {
            let key = format!("{prefix}{key}");
            if let Some(value) = dictionary.get(&key) {
                result.insert(key, plist_json(value)?);
            }
        }
    }
    if result.is_empty() {
        return Err("未找到原应用偏好字段".into());
    }
    Ok(Value::Object(result))
}
#[tauri::command]
pub(super) async fn choose_legacy_data(
    app: tauri::AppHandle,
    include_preferences: bool,
) -> Result<Option<Selection>, String> {
    background(move || {
        let picker = app
            .dialog()
            .file()
            .set_title("选择原应用的 STS2Stats 数据文件夹");
        #[cfg(target_os = "macos")]
        let picker = match app.path().home_dir() {
            Ok(home) => picker.set_directory(home.join("Library/Application Support/STS2Stats")),
            Err(_) => picker,
        };
        let Some(chosen) = picker.blocking_pick_folder() else {
            return Ok(None);
        };
        let root = chosen
            .into_path()
            .map_err(error)?
            .canonicalize()
            .map_err(error)?;
        let storage = app.state::<Storage>();
        if root.starts_with(&storage.root) || storage.root.starts_with(&root) {
            return Err("旧数据与应用数据目录不能重叠".into());
        }
        let sources = describe(&root)?;
        let preferences = if include_preferences {
            let picker = app
                .dialog()
                .file()
                .set_title("选择原应用的 online.quaternijkon.sts2stats.mac.plist 偏好文件")
                .add_filter("原应用偏好", &["plist"]);
            #[cfg(target_os = "macos")]
            let picker = match app.path().home_dir() {
                Ok(home) => picker.set_directory(home.join("Library/Preferences")),
                Err(_) => picker,
            };
            match picker.blocking_pick_file() {
                Some(file) => Some(read_preferences(&file.into_path().map_err(error)?)?),
                None => None,
            }
        } else {
            None
        };
        if sources.is_empty() && preferences.is_none() {
            return Err("所选文件夹没有旧数据集或 save-archive-v1 归档".into());
        }
        let directory = tempfile::Builder::new()
            .prefix(".legacy-migration-")
            .tempdir_in(&storage.root)
            .map_err(error)?;
        let token = hash(directory.path().to_string_lossy().as_bytes());
        let result = Selection {
            token: token.clone(),
            sources: sources
                .values()
                .map(|location| location.source.clone())
                .collect(),
            preferences,
        };
        *storage.legacy.lock().map_err(error)? = Some(Session {
            token,
            sources,
            directory,
            staged: BTreeMap::new(),
        });
        Ok(Some(result))
    })
    .await
}
fn blob_path(index: &Path, blob: &str) -> Result<PathBuf, String> {
    let (digest, suffix) = blob.split_once('.').ok_or("旧归档副本名称无效")?;
    if digest.len() != 64
        || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !matches!(suffix, "run" | "save" | "json")
    {
        return Err("旧归档副本名称无效".into());
    }
    let root = index.parent().ok_or("旧归档路径无效")?;
    let path = root.join("blobs").join(blob);
    confined_storage_path(root, &path)?;
    Ok(path)
}
fn read_entry(index: &Path, entry: &Entry) -> Result<Value, String> {
    let text = read_text(&blob_path(index, &entry.blob)?, u64::MAX)?;
    if !entry
        .blob
        .starts_with(&format!("{}.", hash(text.as_bytes())))
    {
        return Err("旧归档副本校验失败".into());
    }
    let mut value = serde_json::to_value(entry).map_err(error)?;
    value["text"] = json!(text);
    Ok(value)
}
#[tauri::command]
pub(super) async fn read_legacy_source(
    app: tauri::AppHandle,
    token: String,
    id: String,
) -> Result<Value, String> {
    background(move || {
        let storage = app.state::<Storage>();
        let session = storage.legacy.lock().map_err(error)?;
        let session = session.as_ref().filter(|session| session.token == token).ok_or("迁移选择已失效")?;
        let location = session.sources.get(&id).ok_or("未选择该旧来源")?;
        location.verify()?;
        let dataset = location.dataset.as_ref().map(|path| {
            serde_json::from_str::<Value>(&read_text(path, u64::MAX)?).map_err(error)
        }).transpose()?;
        let (runs, progress) = if let Some(path) = &location.index {
            let index = read_index(path)?;
            let runs = index.runs.values().map(|entry| read_entry(path, entry)).collect::<Result<Vec<_>, _>>()?;
            let progress = index.progress.as_ref().map(|entry| read_entry(path, entry)).transpose()?;
            (runs, progress)
        } else { (Vec::new(), None) };
        location.verify()?;
        Ok(json!({ "source": location.source.source, "dataset": dataset, "runs": runs, "progress": progress }))
    }).await
}
#[tauri::command]
pub(super) async fn stage_legacy_source(
    app: tauri::AppHandle,
    token: String,
    id: String,
    text: String,
) -> Result<(), String> {
    background(move || {
        let storage = app.state::<Storage>();
        let mut guard = storage.legacy.lock().map_err(error)?;
        let session = guard
            .as_mut()
            .filter(|session| session.token == token)
            .ok_or("迁移选择已失效")?;
        let location = session.sources.get(&id).ok_or("未选择该旧来源")?;
        location.verify()?;
        let dataset: Value = serde_json::from_str(&text).map_err(error)?;
        summary(&dataset)?;
        if dataset.get("source").and_then(Value::as_str) != Some(location.source.source.as_str()) {
            return Err("迁移数据来源不一致".into());
        }
        let directory = session.directory.path().join(&id);
        fs::create_dir_all(&directory).map_err(error)?;
        if let Some(path) = &location.index {
            let index = read_index(path)?;
            for entry in index.runs.values().chain(index.progress.iter()) {
                for blob in entry.versions.iter().chain(std::iter::once(&entry.blob)) {
                    let source = blob_path(path, blob)?;
                    let bytes = read_text(&source, u64::MAX)?;
                    if !blob.starts_with(&format!("{}.", hash(bytes.as_bytes()))) {
                        return Err("旧归档历史版本校验失败".into());
                    }
                    atomic_copy(&source, &directory.join("blobs").join(blob))?;
                }
            }
        }
        for run in dataset["runs"].as_array().ok_or("迁移记录无效")? {
            let revision = serde_json::to_string(run).map_err(error)?;
            atomic(
                &directory
                    .join("runs")
                    .join(format!("{}.json", hash(revision.as_bytes()))),
                &revision,
            )?;
        }
        atomic(&directory.join("dataset.json"), &text)?;
        if location
            .source
            .source
            .starts_with(&format!("legacy:{}:", location.source.game))
        {
            atomic(
                &directory.join("legacy-source.json"),
                &json!({ "source": location.source.source }).to_string(),
            )?;
        }
        location.verify()?;
        session.staged.insert(id, directory);
        Ok(())
    })
    .await
}

#[derive(Deserialize, Serialize)]
struct Backup {
    target: PathBuf,
    original: Option<PathBuf>,
}
fn rollback(directory: &Path, root: &Path, originals: &[Backup]) -> Result<(), String> {
    let mut failures = Vec::new();
    for backup in originals.iter().rev() {
        let result = (|| {
            if !backup.target.starts_with(root)
                || backup
                    .target
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
            {
                return Err("迁移恢复目标无效".into());
            }
            match &backup.original {
                Some(path)
                    if path.starts_with(directory)
                        && !path
                            .components()
                            .any(|part| matches!(part, std::path::Component::ParentDir)) =>
                {
                    confined_storage_path(root, &backup.target)?;
                    confined_storage_path(directory, path)?;
                    atomic_copy(path, &backup.target)
                }
                Some(_) => Err("迁移恢复副本无效".into()),
                None => match fs::symlink_metadata(&backup.target) {
                    Ok(_) => {
                        confined_storage_path(root, &backup.target)?;
                        fs::remove_file(&backup.target).map_err(error)
                    }
                    Err(failure)
                        if matches!(
                            failure.kind(),
                            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                        ) =>
                    {
                        Ok(())
                    }
                    Err(failure) => Err(error(failure)),
                },
            }
        })();
        if let Err(failure) = result {
            failures.push(failure);
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}
pub(super) fn recover(root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(error)? {
        let entry = entry.map_err(error)?;
        if !entry.file_type().map_err(error)?.is_dir()
            || !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".legacy-migration-")
        {
            continue;
        }
        let directory = entry.path();
        confined_storage_path(root, &directory)?;
        let journal = directory.join("journal.json");
        if journal.exists() && !directory.join("committed").exists() {
            let backups: Vec<Backup> =
                serde_json::from_str(&read_text(&journal, u64::MAX)?).map_err(error)?;
            rollback(&directory, root, &backups)?;
        }
        fs::remove_dir_all(directory).map_err(error)?;
    }
    Ok(())
}
fn replace_all(
    directory: &Path,
    root: &Path,
    replacements: &[(PathBuf, PathBuf)],
) -> Result<(), String> {
    let backup = directory.join("backups");
    fs::create_dir_all(&backup).map_err(error)?;
    let mut originals = Vec::new();
    for (index, (target, _)) in replacements.iter().enumerate() {
        let original = if target.exists() {
            let path = backup.join(index.to_string());
            atomic_copy(target, &path)?;
            Some(path)
        } else {
            None
        };
        originals.push(Backup {
            target: target.clone(),
            original,
        });
    }
    let journal = directory.join("journal.json");
    atomic(&journal, &serde_json::to_string(&originals).map_err(error)?)?;
    for (target, source) in replacements {
        if let Err(failure) = atomic_copy(source, target) {
            return Err(match rollback(directory, root, &originals) {
                Ok(()) => {
                    let _ = fs::remove_file(&journal);
                    failure
                }
                Err(error) => format!("{failure}; migration rollback failed: {error}"),
            });
        }
    }
    if let Err(failure) = atomic(&directory.join("committed"), "complete") {
        return Err(match rollback(directory, root, &originals) {
            Ok(()) => {
                let _ = fs::remove_file(&journal);
                failure
            }
            Err(error) => format!("{failure}; migration rollback failed: {error}"),
        });
    }
    Ok(())
}
#[tauri::command]
pub(super) async fn commit_legacy_migration(
    app: tauri::AppHandle,
    token: String,
    ids: Vec<String>,
    active: BTreeMap<String, String>,
    preferences: String,
) -> Result<(), String> {
    background(move || {
        let storage = app.state::<Storage>();
        let _writes = storage.writes.lock().map_err(error)?;
        let mut guard = storage.legacy.lock().map_err(error)?;
        let session = guard
            .as_ref()
            .filter(|session| session.token == token)
            .ok_or("迁移选择已失效")?;
        let _: Value = serde_json::from_str(&preferences).map_err(error)?;
        let mut replacements = Vec::new();
        let mut blobs = StagedFiles::default();
        for (location, staged) in selected_stages(session, &ids)? {
            location.verify()?;
            let root = game_dir(&storage, &location.source.game)?;
            let archive = root
                .join("archives")
                .join(hash(location.source.source.as_bytes()));
            confined_storage_path(&storage.root, &archive)?;
            for name in ["blobs", "runs"] {
                let source = staged.join(name);
                if !source.exists() {
                    continue;
                }
                for entry in fs::read_dir(source).map_err(error)? {
                    let entry = entry.map_err(error)?;
                    let target = archive.join(name).join(entry.file_name());
                    confined_storage_path(&storage.root, &target)?;
                    blobs.put(target, &read_text(&entry.path(), u64::MAX)?)?;
                }
            }
            replacements.push((archive.join("dataset.json"), staged.join("dataset.json")));
            let alias = staged.join("legacy-source.json");
            if alias.exists() {
                let digest = location
                    .source
                    .id
                    .strip_prefix(&format!("{}-", location.source.game))
                    .ok_or("旧来源映射无效")?;
                let target = root
                    .join("archives")
                    .join(digest)
                    .join("legacy-source.json");
                confined_storage_path(&storage.root, &target)?;
                replacements.push((target, alias));
            }
        }
        for (game, id) in &active {
            if !ids.contains(id) {
                return Err("激活来源不在本次迁移选择中".into());
            }
            let location = session.sources.get(id).ok_or("激活来源无效")?;
            if &location.source.game != game {
                return Err("迁移游戏与来源不一致".into());
            }
            let staged = session.staged.get(id).ok_or("激活来源尚未暂存")?;
            replacements.push((
                game_dir(&storage, game)?.join("dataset.json"),
                staged.join("dataset.json"),
            ));
        }
        let preference_path = session.directory.path().join("preferences.json");
        atomic(&preference_path, &preferences)?;
        replacements.push((storage.root.join("preferences.json"), preference_path));
        if let Err(failure) = replace_all(session.directory.path(), &storage.root, &replacements) {
            blobs.committed = failure.contains("migration rollback failed:");
            if blobs.committed {
                if let Some(session) = guard.take() {
                    let _ = session.directory.keep();
                }
            }
            return Err(failure);
        }
        blobs.committed = true;
        *guard = None;
        Ok(())
    })
    .await
}
#[tauri::command]
pub(super) async fn cancel_legacy_migration(
    app: tauri::AppHandle,
    token: String,
) -> Result<(), String> {
    background(move || {
        let storage = app.state::<Storage>();
        let mut guard = storage.legacy.lock().map_err(error)?;
        if guard.as_ref().is_some_and(|session| session.token == token) {
            *guard = None;
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_deleted_source_archives_and_rejects_blob_traversal() {
        let directory = tempfile::tempdir().unwrap();
        let source = "/synthetic/profile2/saves";
        let archive = directory
            .path()
            .join("save-archive-v1")
            .join(hash(source.as_bytes()));
        let text = "{\"win\":true}";
        let blob = format!("{}.run", hash(text.as_bytes()));
        atomic(&archive.join("blobs").join(&blob), text).unwrap();
        let index = json!({ "version": 1, "runs": { "key": { "id": "old.run", "name": "old.run", "blob": blob, "versions": [blob], "importedAt": 1700000000000.0, "modified": 42 } }, "sourceDigests": { "/synthetic/profile2/saves/old.run": "digest" } });
        atomic(&archive.join("index.json"), &index.to_string()).unwrap();
        let sources = describe(directory.path()).unwrap();
        let location = sources.values().next().unwrap();
        assert_eq!(location.source.source, source);
        assert_eq!(location.source.runs, 1);
        assert!(blob_path(&archive.join("index.json"), "../outside.run").is_err());
        let entry = read_index(&archive.join("index.json"))
            .unwrap()
            .runs
            .remove("key")
            .unwrap();
        assert_eq!(
            read_entry(&archive.join("index.json"), &entry).unwrap()["id"],
            "old.run"
        );
    }

    #[test]
    fn retry_commits_only_sources_selected_in_the_current_attempt() {
        let source = tempfile::tempdir().unwrap();
        for (path, name) in [
            ("dataset.json", "/synthetic/sts2"),
            ("STS1/dataset.json", "/synthetic/sts1"),
        ] {
            atomic(
                &source.path().join(path),
                &json!({ "source": name, "importedAt": 1, "runs": [], "progress": null })
                    .to_string(),
            )
            .unwrap();
        }
        let sources = describe(source.path()).unwrap();
        let ids: Vec<String> = sources.keys().cloned().collect();
        let directory = tempfile::tempdir().unwrap();
        let staged = ids
            .iter()
            .map(|id| (id.clone(), directory.path().join(id)))
            .collect();
        let session = Session {
            token: "synthetic".into(),
            sources,
            directory,
            staged,
        };
        let selected = selected_stages(&session, &[ids[1].clone()]).unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].0.source.id, ids[1]);
        assert!(selected_stages(&session, &[]).unwrap().is_empty());
        assert!(selected_stages(&session, &["unknown".into()]).is_err());
        assert!(selected_stages(&session, &[ids[0].clone(), ids[0].clone()]).is_err());
    }

    #[test]
    fn retains_a_populated_legacy_dataset_without_a_source_path() {
        let directory = tempfile::tempdir().unwrap();
        atomic(
            &directory.path().join("dataset.json"),
            &json!({ "source": "", "importedAt": 123, "runs": [{ "id": "synthetic.run" }], "progress": null }).to_string(),
        ).unwrap();
        let sources = describe(directory.path()).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources.values().next().unwrap().source.source, "");
        assert_eq!(sources.values().next().unwrap().source.runs, 1);
    }

    #[test]
    fn plist_import_reads_binary_filters_and_only_local_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("synthetic.plist");
        let mut values = plist::Dictionary::new();
        values.insert("appearance".into(), plist::Value::String("dark".into()));
        values.insert(
            "analysisFilter".into(),
            plist::Value::Data(b"{\"ascensions\":[10]}".to_vec()),
        );
        values.insert(
            "serverURL".into(),
            plist::Value::String("must-not-migrate".into()),
        );
        plist::Value::Dictionary(values)
            .to_file_binary(&path)
            .unwrap();
        let imported = read_preferences(&path).unwrap();
        assert_eq!(imported["appearance"], "dark");
        assert_eq!(imported["analysisFilter"]["ascensions"][0], 10);
        assert!(imported.get("serverURL").is_none());
    }
    #[test]
    fn reconnects_an_unknown_legacy_source_by_its_original_hash() {
        let directory = tempfile::tempdir().unwrap();
        let source = "/synthetic/missing-profile/saves";
        let digest = hash(source.as_bytes());
        let legacy = format!("legacy:sts2:{digest}");
        atomic(
            &directory
                .path()
                .join("archives")
                .join(&digest)
                .join("legacy-source.json"),
            &json!({ "source": legacy }).to_string(),
        )
        .unwrap();
        atomic(
            &directory
                .path()
                .join("archives")
                .join(hash(legacy.as_bytes()))
                .join("dataset.json"),
            &json!({ "source": legacy, "runs": [{ "id": "retained.run" }] }).to_string(),
        )
        .unwrap();
        let restored = load_archive(directory.path(), "sts2", source)
            .unwrap()
            .unwrap();
        assert_eq!(restored["source"], source);
        assert_eq!(restored["runs"][0]["id"], "retained.run");
        assert!(load_archive(
            directory.path(),
            "sts2",
            "/synthetic/different-profile/saves"
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn failed_multisource_commit_restores_every_checkpoint() {
        let directory = tempfile::tempdir().unwrap();
        let old = directory.path().join("old.json");
        let staged = directory.path().join("staged.json");
        let blocked = directory.path().join("blocked");
        atomic(&old, "old").unwrap();
        atomic(&staged, "new").unwrap();
        atomic(&blocked, "blocked parent").unwrap();
        let failure = replace_all(
            directory.path(),
            directory.path(),
            &[
                (old.clone(), staged.clone()),
                (blocked.join("dataset.json"), staged),
            ],
        )
        .unwrap_err();
        assert!(!failure.contains("migration rollback failed:"));
        assert_eq!(read_text(&old, u64::MAX).unwrap(), "old");
        assert!(!directory.path().join("journal.json").exists());
    }
    #[test]
    fn restores_remaining_checkpoints_when_one_recovery_target_is_invalid() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let session = root.path().join(".legacy-migration-synthetic");
        let target = root.path().join("sts2/dataset.json");
        let original = session.join("backups/0");
        atomic(&target, "partially-committed").unwrap();
        atomic(&original, "original").unwrap();
        let backups = vec![
            Backup {
                target: target.clone(),
                original: Some(original),
            },
            Backup {
                target: outside.path().join("outside.json"),
                original: None,
            },
        ];
        assert!(rollback(&session, root.path(), &backups).is_err());
        assert_eq!(read_text(&target, u64::MAX).unwrap(), "original");
        assert!(!outside.path().join("outside.json").exists());
    }
    #[test]
    fn recovers_interrupted_migration_before_reading_authoritative_data() {
        let root = tempfile::tempdir().unwrap();
        let session = root.path().join(".legacy-migration-synthetic");
        let target = root.path().join("sts2/dataset.json");
        let backup = session.join("backups/0");
        atomic(&target, "partially-committed").unwrap();
        atomic(&backup, "original").unwrap();
        let records = vec![Backup {
            target: target.clone(),
            original: Some(backup),
        }];
        atomic(
            &session.join("journal.json"),
            &serde_json::to_string(&records).unwrap(),
        )
        .unwrap();
        recover(root.path()).unwrap();
        assert_eq!(read_text(&target, u64::MAX).unwrap(), "original");
        assert!(!session.exists());
    }
}
