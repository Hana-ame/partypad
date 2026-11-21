using System;
using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace PartyPad
{
    /// <summary>
    /// Drop-in Unity MonoBehaviour bridge for PartyPad.
    /// - Desktop / Editor: Starts a zero-dependency local WebSocket server (ws://localhost:8765/partypad/)
    ///   that connects directly to the browser PartyPad Host Dashboard.
    /// - WebGL: Talks directly to window.PartyPadBridge in the same browser page via PartyPadWebGL.jslib.
    /// All events are marshaled safely onto Unity's Main Thread in Update().
    /// </summary>
    public class PartyPadBridge : MonoBehaviour
    {
        [Header("Desktop / Editor WebSocket Server")]
        public int listenPort = 8765;
        public string path = "/partypad/";

        public event Action<PartyPadEvent> OnPlayerJoin;
        public event Action<PartyPadEvent> OnPlayerLeave;
        public event Action<PartyPadEvent> OnInput;
        public event Action<PartyPadEvent> OnMotion;
        public event Action<PartyPadEvent> OnAction;
        public event Action<PartyPadEvent> OnDraw;
        public event Action<PartyPadEvent> OnPrivateAck;

        private readonly ConcurrentQueue<string> _inboundQueue = new ConcurrentQueue<string>();

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void PartyPad_RegisterUnityObject(string gameObjectName);

        [DllImport("__Internal")]
        private static extern void PartyPad_SendCommand(string jsonCommand);
#else
        private HttpListener _listener;
        private CancellationTokenSource _cts;
        private WebSocket _activeHostSocket;
#endif

        private void Start()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            PartyPad_RegisterUnityObject(gameObject.name);
#else
            StartDesktopServer();
#endif
        }

        private void Update()
        {
            while (_inboundQueue.TryDequeue(out var json))
            {
                DispatchJson(json);
            }
        }

        /// <summary>
        /// Called by PartyPadWebGL.jslib in WebGL builds (SendMessage).
        /// </summary>
        public void OnWebGLMessage(string json)
        {
            _inboundQueue.Enqueue(json);
        }

        public void SendPrivateMessage(string playerId, string title, string body, bool secret = true)
        {
            var cmd = new PrivateMessageCommand
            {
                playerId = playerId,
                title = title,
                body = body,
                secret = secret,
            };
            SendRawCommand(JsonUtility.ToJson(cmd));
        }

        public void Vibrate(string playerId, int[] pattern)
        {
            var cmd = new VibrateCommand
            {
                playerId = playerId,
                pattern = pattern ?? new[] { 40 },
            };
            SendRawCommand(JsonUtility.ToJson(cmd));
        }

        /// <summary>
        /// Push any raw JSON layout schema (e.g. broadcast_layout or set_layout).
        /// </summary>
        public void SendRawCommand(string jsonCommand)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            PartyPad_SendCommand(jsonCommand);
#else
            var sock = _activeHostSocket;
            if (sock == null || sock.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(jsonCommand);
            _ = sock.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
#endif
        }

        private void DispatchJson(string json)
        {
            PartyPadEvent ev;
            try
            {
                ev = JsonUtility.FromJson<PartyPadEvent>(json);
            }
            catch
            {
                return;
            }
            if (ev == null || string.IsNullOrEmpty(ev.type)) return;

            switch (ev.type)
            {
                case "player_join":
                case "player_reconnect":
                    OnPlayerJoin?.Invoke(ev);
                    break;
                case "player_leave":
                    OnPlayerLeave?.Invoke(ev);
                    break;
                case "input":
                    OnInput?.Invoke(ev);
                    break;
                case "motion":
                    OnMotion?.Invoke(ev);
                    break;
                case "draw":
                    OnDraw?.Invoke(ev);
                    break;
                case "action":
                    OnAction?.Invoke(ev);
                    break;
                case "private_ack":
                    OnPrivateAck?.Invoke(ev);
                    break;
            }
        }

#if !(UNITY_WEBGL && !UNITY_EDITOR)
        private void StartDesktopServer()
        {
            _cts = new CancellationTokenSource();
            _listener = new HttpListener();
            var normalizedPath = path.EndsWith("/") ? path : path + "/";
            _listener.Prefixes.Add($"http://localhost:{listenPort}{normalizedPath}");
            _listener.Start();
            Debug.Log($"[PartyPad-Unity] Listening on ws://localhost:{listenPort}{normalizedPath}");
            _ = AcceptLoopAsync(_cts.Token);
        }

        private async Task AcceptLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = await _listener.GetContextAsync();
                }
                catch
                {
                    break;
                }

                if (!ctx.Request.IsWebSocketRequest)
                {
                    ctx.Response.StatusCode = 400;
                    ctx.Response.Close();
                    continue;
                }

                var wsCtx = await ctx.AcceptWebSocketAsync(null);
                _activeHostSocket = wsCtx.WebSocket;
                _ = ReceiveLoopAsync(wsCtx.WebSocket, ct);
            }
        }

        private async Task ReceiveLoopAsync(WebSocket ws, CancellationToken ct)
        {
            var buf = new byte[8192];
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                try
                {
                    var res = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                    if (res.MessageType == WebSocketMessageType.Close) break;
                    var msg = Encoding.UTF8.GetString(buf, 0, res.Count);
                    _inboundQueue.Enqueue(msg);
                }
                catch
                {
                    break;
                }
            }
        }

        private void OnDestroy()
        {
            _cts?.Cancel();
            try { _listener?.Stop(); } catch { }
            try { _activeHostSocket?.Dispose(); } catch { }
        }
#endif
    }
}
