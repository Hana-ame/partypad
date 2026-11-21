using UnityEngine;

namespace PartyPad
{
    /// <summary>
    /// Example Unity component showing how to bind PartyPadBridge in 15 lines.
    /// Attach both PartyPadBridge and PartyPadDemo to the same GameObject.
    /// </summary>
    public class PartyPadDemo : MonoBehaviour
    {
        public PartyPadBridge bridge;
        public Transform targetAvatar;
        public float moveSpeed = 5f;

        private Vector2 _move;

        private void Awake()
        {
            if (bridge == null) bridge = GetComponent<PartyPadBridge>();

            bridge.OnPlayerJoin += ev =>
            {
                Debug.Log($"[Unity] Player joined: {ev.name} (Slot #{ev.slot})");
                bridge.SendPrivateMessage(ev.playerId, "Unity 秘密身份", $"你是 #{ev.slot + 1} 号特工", secret: true);
            };

            bridge.OnInput += ev =>
            {
                _move = new Vector2(ev.lx, -ev.ly);
            };

            bridge.OnMotion += ev =>
            {
                if (targetAvatar != null)
                {
                    targetAvatar.rotation = new Quaternion(ev.q.x, ev.q.y, ev.q.z, ev.q.w);
                }
                if (ev.hit > 0f)
                {
                    Debug.Log($"[Unity] Swing hit! peak={ev.hit:F2}");
                    bridge.Vibrate(ev.playerId, new[] { 35 });
                }
            };
        }

        private void Update()
        {
            if (targetAvatar != null)
            {
                targetAvatar.position += new Vector3(_move.x, 0f, _move.y) * (moveSpeed * Time.deltaTime);
            }
        }
    }
}
