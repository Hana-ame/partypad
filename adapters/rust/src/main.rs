//! PartyPad Rust Server Adapter (Tokio + tokio-tungstenite)
//!
//! Listens on ws://127.0.0.1:8765/partypad and receives real-time gamepad inputs,
//! IMU motion frames, live drawing strokes, and actions from the PartyPad Host.
//! Can push private secret cards, layout changes, and vibration commands back to phones.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuatData {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboundEvent {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub player_id: String,
    #[serde(default)]
    pub slot: usize,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub buttons: u32,
    #[serde(default)]
    pub lx: f32,
    #[serde(default)]
    pub ly: f32,
    #[serde(default)]
    pub rx: f32,
    #[serde(default)]
    pub ry: f32,
    pub q: Option<QuatData>,
    #[serde(default)]
    pub hit: f32,
    #[serde(default)]
    pub op: u8,
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
    #[serde(default)]
    pub stroke_id: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateCmd<'a> {
    cmd: &'a str,
    player_id: &'a str,
    title: &'a str,
    body: &'a str,
    style: &'a str,
    secret: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VibrateCmd<'a> {
    cmd: &'a str,
    player_id: &'a str,
    pattern: &'a [u32],
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "127.0.0.1:8765";
    let listener = TcpListener::bind(addr).await?;
    println!("[PartyPad-Rust] Listening on ws://{addr}/partypad");

    while let Ok((stream, peer)) = listener.accept().await {
        tokio::spawn(async move {
            let ws_stream = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => {
                    eprintln!("[PartyPad-Rust] WS handshake error from {peer}: {e}");
                    return;
                }
            };
            println!("[PartyPad-Rust] Host connected from {peer}");
            let (mut write, mut read) = ws_stream.split();

            while let Some(Ok(msg)) = read.next().await {
                if !msg.is_text() {
                    continue;
                }
                let Ok(ev) = serde_json::from_str::<InboundEvent>(msg.to_text().unwrap_or("")) else {
                    continue;
                };

                match ev.kind.as_str() {
                    "player_join" | "player_reconnect" => {
                        println!("[JOIN] {} ({}) slot={}", ev.name, ev.player_id, ev.slot);
                        let cmd = PrivateCmd {
                            cmd: "send_private",
                            player_id: &ev.player_id,
                            title: "Rust 服务端身份卡",
                            body: "你已连入 Rust 服务端（按住查看防偷窥）",
                            style: "card",
                            secret: true,
                        };
                        let _ = write.send(Message::Text(serde_json::to_string(&cmd).unwrap().into())).await;
                    }
                    "input" => {
                        if ev.buttons != 0 {
                            println!("[INPUT] {} buttons=0x{:x} L=({:.2},{:.2})", ev.player_id, ev.buttons, ev.lx, ev.ly);
                        }
                    }
                    "motion" if ev.hit > 0.0 => {
                        println!("[SWING] {} peak={:.2}", ev.player_id, ev.hit);
                        let cmd = VibrateCmd { cmd: "vibrate", player_id: &ev.player_id, pattern: &[35] };
                        let _ = write.send(Message::Text(serde_json::to_string(&cmd).unwrap().into())).await;
                    }
                    "draw" => {
                        println!("[DRAW] {} op={} stroke={} ({:.2},{:.2})", ev.player_id, ev.op, ev.stroke_id, ev.x, ev.y);
                    }
                    _ => {}
                }
            }
        });
    }
    Ok(())
}
