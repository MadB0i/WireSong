mod capture;
mod classify;
mod config;
mod mapper;
mod portscan;
mod ws;

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
                eprintln!("warning: no default interface, capture disabled: {err}");
                String::new()
            }
        },
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("error: failed to start tokio runtime: {err}");
            return ExitCode::FAILURE;
        }
    };

    let code = runtime.block_on(async move {
        let (tx, _) = tokio::sync::broadcast::channel(512);
        let capture_tx = tx.clone();

        let server = tokio::spawn(async move {
            match tokio::net::TcpListener::bind("127.0.0.1:3000").await {
                Ok(listener) => {
                    println!("WS server listening on ws://127.0.0.1:3000/ws");
                    if let Err(err) = axum::serve(listener, ws::router(tx)).await {
                        eprintln!("error: ws server: {err}");
                    }
                }
                Err(err) => eprintln!("error: failed to bind 127.0.0.1:3000: {err}"),
            }
        });

        if interface.is_empty() {
            println!("capture disabled; running without a capture source");
        } else {
            let max_packets = args.max_packets;
            let capture_interface = interface.clone();
            let capture_task = tokio::task::spawn_blocking(move || {
                capture::run(&capture_interface, max_packets, capture_tx)
            });
            match capture_task.await {
                Ok(Ok(count)) => println!("captured {count} packets on {interface}"),
                Ok(Err(err)) => eprintln!("warning: capture failed, ws server continues: {err}"),
                Err(err) => eprintln!("error: capture task failed: {err}"),
            }
        }

        let _ = server.await;
        0
    });

    ExitCode::from(code)
}
