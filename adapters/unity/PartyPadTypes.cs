using System;

namespace PartyPad
{
    [Serializable]
    public struct QuatData
    {
        public float x;
        public float y;
        public float z;
        public float w;
    }

    [Serializable]
    public class PartyPadEvent
    {
        public string type;
        public string playerId;
        public int slot;
        public string name;
        public int seq;
        public uint buttons;
        public float lx;
        public float ly;
        public float rx;
        public float ry;
        public QuatData q;
        public float omega;
        public float hit;
        public string id;
        public string value;
        public string msgId;
        public int op;
        public float x;
        public float y;
        public string color;
        public int width;
        public int strokeId;

        public bool IsButtonPressed(int bit) => ((buttons >> bit) & 1u) == 1u;
    }

    [Serializable]
    public class PrivateMessageCommand
    {
        public string cmd = "send_private";
        public string playerId;
        public string title;
        public string body;
        public string style = "card";
        public bool secret = true;
    }

    [Serializable]
    public class VibrateCommand
    {
        public string cmd = "vibrate";
        public string playerId;
        public int[] pattern;
    }
}
