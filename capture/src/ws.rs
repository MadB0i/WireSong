use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use tokio::sync::broadcast;

use crate::mapper::NoteEvent;

#[derive(Clone)]
pub struct AppState {
    pub tx: broadcast::Sender<NoteEvent>,
}

pub fn router(tx: broadcast::Sender<NoteEvent>) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/ws", get(ws_handler))
        .with_state(AppState { tx })
}

async fn index() -> &'static str {
    "WireSong capture server is running"
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut rx = state.tx.subscribe();
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(note) => {
                        let text = serde_json::to_string(&note).unwrap_or_else(|err| {
                            serde_json::json!({ "type": "control", "message": format!("serialize error: {err}") })
                                .to_string()
                        });
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if socket
                            .send(control_message("You are lagging behind — some events were dropped"))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                    None => break,
                }
            }
        }
    }
}

fn control_message(text: &str) -> Message {
    Message::Text(serde_json::json!({ "type": "control", "message": text }).to_string().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn control_message_has_spec_shape() {
        let message = control_message("You are lagging behind — some events were dropped");
        let Message::Text(text) = message else {
            panic!("expected text message");
        };
        let value: serde_json::Value = serde_json::from_str(&text).expect("valid json");
        assert_eq!(value["type"], "control");
        assert_eq!(
            value["message"],
            "You are lagging behind — some events were dropped"
        );
    }

    #[tokio::test]
    async fn slow_receiver_encounters_lagged() {
        let (tx, _) = broadcast::channel(16);
        let mut rx = tx.subscribe();
        let sender = tokio::spawn(async move {
            for i in 0..100u32 {
                let _ = tx.send(i);
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });

        let mut saw_lagged = false;
        loop {
            match rx.recv().await {
                Ok(_) => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    saw_lagged = true;
                    break;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        assert!(saw_lagged, "slow receiver should hit Lagged");
        sender.await.expect("sender finishes");
    }

    #[test]
    fn send_with_no_receivers_returns_error_ignored_by_design() {
        let (tx, rx) = broadcast::channel(16);
        drop(rx);
        let note = NoteEvent {
            timestamp_ms: 1,
            event_type: "udp".to_string(),
            pitch: 60,
            velocity: 0.5,
            duration_ms: 100,
            pan: 0.0,
            size_bytes: 100,
        };
        assert!(tx.send(note).is_err());
    }
}
