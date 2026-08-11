mod capture;
mod classify;
mod portscan;

use clap::Parser;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "wiresong", version, about = "Real-time network packet sonification backend")]
struct Args {
    #[arg(long, help = "Capture interface name; default: first non-loopback device")]
    interface: Option<String>,

    #[arg(long, help = "List available capture interfaces and exit")]
    list: bool,

    #[arg(long, default_value_t = 0, help = "Stop after this many packets (0 = run until Ctrl+C)")]
    max_packets: u64,
}

fn main() -> ExitCode {
    let args = Args::parse();

    if args.list {
        return match capture::list_devices() {
            Ok(devices) => {
                for device in devices {
                    println!("{device}");
                }
                ExitCode::SUCCESS
            }
            Err(err) => {
                eprintln!("error: {err}");
                ExitCode::FAILURE
            }
        };
    }

    let interface = match args.interface {
        Some(name) => name,
        None => match capture::default_device() {
            Ok(name) => name,
            Err(err) => {
                eprintln!("error: no default interface: {err}");
                return ExitCode::FAILURE;
            }
        },
    };

    match capture::run(&interface, args.max_packets) {
        Ok(count) => {
            println!("captured {count} packets on {interface}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}
