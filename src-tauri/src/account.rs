use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const ORIGIN: &str = "https://sts2stats.quaternijkon.online/api/v1";
#[derive(Serialize)]
pub(crate) struct AccountResponse {
    status: u16,
    body: String,
}
fn valid_route(method: &str, route: &str) -> bool {
    match method {
        "GET" => matches!(
            route,
            "/auth/session" | "/vaults" | "/vaults/sts1" | "/vaults/sts2"
        ),
        "POST" => matches!(
            route,
            "/auth/register" | "/auth/login" | "/auth/logout" | "/auth/password" | "/auth/delete"
        ),
        "PUT" => matches!(route, "/vaults/sts1" | "/vaults/sts2"),
        _ => false,
    }
}

/// Account credentials stay in Keychain / Windows Credential Manager, never JS storage.
#[tauri::command]
pub(crate) async fn account_request(
    method: String,
    route: String,
    body: Option<String>,
    account_id: Option<String>,
) -> Result<AccountResponse, String> {
    if !valid_route(&method, &route) {
        return Err("不支持的账户请求".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring::Entry::new("com.sts2stats.desktop", "sts2stats.quaternijkon.online")
            .map_err(|_| "无法访问系统凭据存储".to_string())?;
        let token = match entry.get_password() {
            Ok(token) => Some(token),
            Err(keyring::Error::NoEntry) => None,
            Err(_) => return Err("无法读取系统登录会话".into()),
        };
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "无法初始化账户连接".to_string())?;
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| "请求方法无效".to_string())?;
        let mut request = client
            .request(method, format!("{ORIGIN}{route}"))
            .header("X-STS-Client", "desktop");
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if let Some(account_id) = account_id {
            request = request.header("X-STS-Account", account_id);
        }
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(body);
        }
        let response = request
            .send()
            .map_err(|_| "无法连接账户服务，请检查网络后重试".to_string())?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .map_err(|_| "无法读取账户服务响应".to_string())?;
        let mut value: Value =
            serde_json::from_str(&text).map_err(|_| "账户服务响应格式无效".to_string())?;
        if (200..300).contains(&status) {
            if let Some(token) = value.get("token").and_then(Value::as_str) {
                entry
                    .set_password(token)
                    .map_err(|_| "无法安全保存登录会话".to_string())?;
            }
            if matches!(route.as_str(), "/auth/logout" | "/auth/delete") {
                match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => (),
                    Err(_) => return Err("登录已结束，但系统凭据清理失败".into()),
                }
            }
        }
        if let Some(object) = value.as_object_mut() {
            object.remove("token");
        }
        Ok(AccountResponse {
            status,
            body: value.to_string(),
        })
    })
    .await
    .map_err(|_| "账户连接任务未完成".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fixed_account_endpoints_are_allowed() {
        assert!(valid_route("GET", "/vaults/sts2"));
        assert!(valid_route("POST", "/auth/login"));
        for route in [
            "https://other.test",
            "//other.test",
            "/vaults/../auth/login",
            "/vaults/sts2?x=1",
            "/vaults/sts2#x",
        ] {
            assert!(!valid_route("GET", route));
        }
        assert!(!valid_route("DELETE", "/auth/delete"));
    }
}
