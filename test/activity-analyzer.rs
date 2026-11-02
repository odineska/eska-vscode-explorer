//! Private Windows native-fixture adapter; compile with rustc and select ESKA_HOST_ACTIVITY_ANALYZER.

use std::{env, fs, process::Command, thread, time::Duration};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "check-config")
        && fs::exists(".activity-validation-hold")?
    {
        fs::write(
            ".activity-validation-started",
            std::process::id().to_string(),
        )?;
        thread::sleep(Duration::from_secs(30));
    }
    let mut command =
        Command::new(env::var_os("ESKA_TEST_ANALYZER_BINARY").ok_or("missing native analyzer")?);
    command
        .args(&args)
        .env("BSL_LOG", "warn,bsl_analyzer::workspace=info");
    let lsp = args.first().is_some_and(|arg| arg == "lsp");
    if lsp {
        command.env(
            "BSL_LOG_FILE",
            format!(".activity-lsp-{}.log", std::process::id()),
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn()?;
    if lsp {
        fs::write(
            format!(".activity-lsp-{}.child", std::process::id()),
            child.id().to_string(),
        )?;
    }
    std::process::exit(child.wait()?.code().unwrap_or(1));
}
