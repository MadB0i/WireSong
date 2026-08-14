mod capture;
mod classify;
mod config;
mod mapper;
mod portscan;
mod ws;

use clap::Parser;
use std::process::ExitCode;
use std::time::Instant;

#[derive(Parser)]
#[command(name = "wiresong", version, about = "Real-time network packet sonification backend")]
struct Args {
    #[arg(long, help = "Capture interface name; default: first non-loopback device")]
    interface: Option<String>,

    #[arg(long, help = "List available capture interfaces and exit")]
    list: bool,

    #[arg(long, default_value_t = 0, help = "Stop after this many packets (0 = run until Ctrl+C)")]
    max_packets: u64,

    #[arg(long, help = "Replay an offline pcap file instead of live capture")]
    pcap: Option<String>,

    #[arg(long, help = "Generate synthetic network traffic instead of live capture")]
    synthetic: bool,

    #[arg(long, default_value_t = 20, help = "Synthetic event rate in notes/sec (with --synthetic)")]
    rate: u64,

    #[arg(long, help = "Benchmark mode: disable the note rate limiter and report throughput")]
    bench: bool,
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

        let bind_addr = match std::env::var("PORT") {
            Ok(port) => format!("0.0.0.0:{port}"),
            Err(_) => String::from("127.0.0.1:3000"),
        };
        let bind_addr_for_log = bind_addr.clone();
        let server = tokio::spawn(async move {
            match tokio::net::TcpListener::bind(&bind_addr).await {
                Ok(listener) => {
                    println!("WS server listening on ws://{bind_addr_for_log}/ws");
                    if let Err(err) = axum::serve(listener, ws::router(tx)).await {
                        eprintln!("error: ws server: {err}");
                    }
                }
                Err(err) => eprintln!("error: failed to bind {bind_addr_for_log}: {err}"),
            }
        });

        let max_packets = args.max_packets;
        let started = Instant::now();
        let source_result: Result<(u64, u64), Box<dyn std::error::Error + Send + Sync>> =
            if let Some(path) = &args.pcap {
                let path = path.clone();
                let task = tokio::task::spawn_blocking(move || {
                    capture::run_offline(&path, max_packets, !args.bench, capture_tx)
                });
                match task.await {
                    Ok(result) => result,
                    Err(err) => {
                        eprintln!("error: replay task failed: {err}");
                        return 1;
                    }
                }
            } else if args.synthetic {
                let task = tokio::task::spawn_blocking(move || {
                    capture::run_synthetic(args.rate, max_packets, capture_tx)
                });
                match task.await {
                    Ok(Ok(notes)) => Ok((notes, notes)),
                    Ok(Err(err)) => Err(err),
                    Err(err) => {
                        eprintln!("error: synthetic task failed: {err}");
                        return 1;
                    }
                }
            } else {
                let interface = match args.interface {
                    Some(name) => name,
                    None => match capture::default_device() {
                        Ok(name) => name,
                        Err(err) => {
                            eprintln!(
                                "warning: no default interface, capture disabled: {err}"
                            );
                            String::new()
                        }
                    },
                };
                if interface.is_empty() {
                    println!("capture disabled; running without a capture source");
                    let _ = server.await;
                    return 0;
                }
                let capture_interface = interface.clone();
                let task = tokio::task::spawn_blocking(move || {
                    capture::run(&capture_interface, max_packets, capture_tx)
                });
                match task.await {
                    Ok(Ok(count)) => Ok((count, 0)),
                    Ok(Err(err)) => {
                        eprintln!("warning: capture failed, ws server continues: {err}");
                        let _ = server.await;
                        return 0;
                    }
                    Err(err) => {
                        eprintln!("error: capture task failed: {err}");
                        return 1;
                    }
                }
            };

        match source_result {
            Ok((packets, notes)) => {
                let elapsed = started.elapsed().as_secs_f64();
                println!("finished: {packets} packets / {notes} notes in {elapsed:.2}s");
                if elapsed > 0.0 {
                    println!(
                        "throughput: {:.0} packets/s, {:.0} notes/s",
                        packets as f64 / elapsed,
                        notes as f64 / elapsed
                    );
                }
            }
            Err(err) => eprintln!("error: capture source failed: {err}"),
        }

        // One-shot sources (--pcap/--synthetic) finish; live capture ends on Ctrl+C.
        // Either way the ws server should shut down once the source is done.
        server.abort();
        let _ = server.await;
        0
    });

    ExitCode::from(code)
}