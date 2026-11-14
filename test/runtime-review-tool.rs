//! Deterministic process fixture for native review UI acceptance; never accesses an infobase.
use std::{env, fs, io::Write, path::PathBuf};

fn main() {
    let root = PathBuf::from(env::var_os("ESKA_REVIEW_FIXTURE").unwrap());
    let args: Vec<String> = env::args().skip(1).collect();
    let mut log = fs::OpenOptions::new().create(true).append(true).open(root.join("calls.log")).unwrap();
    writeln!(log, "{args:?}").unwrap();
    if args.iter().any(|arg| arg == "--version") {
        println!("eska-build 0.30.1");
    } else if args.iter().any(|arg| arg == "run") {
        println!("{{\"status\":\"finished\"}}");
    } else if args.iter().any(|arg| arg == "--confirm") {
        fs::write(root.join("confirmed"), "confirmed").unwrap();
        println!("{{\"status\":\"applied\"}}");
    } else if root.join("confirmed").exists() {
        println!("{{\"status\":\"preview\",\"plan\":{{\"mode\":\"unchanged\"}}}}");
    } else {
        print!("{}", fs::read_to_string(root.join("plan.json")).unwrap());
    }
}
