package partypad

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Quaternion struct {
	X float32 `json:"x"`
	Y float32 `json:"y"`
	Z float32 `json:"z"`
	W float32 `json:"w"`
}

type InboundEvent struct {
	Type     string          `json:"type"`
	PlayerID string          `json:"playerId"`
	Slot     int             `json:"slot,omitempty"`
	Name     string          `json:"name,omitempty"`
	Seq      uint16          `json:"seq,omitempty"`
	Buttons  uint32          `json:"buttons,omitempty"`
	LX       float32         `json:"lx,omitempty"`
	LY       float32         `json:"ly,omitempty"`
	RX       float32         `json:"rx,omitempty"`
	RY       float32         `json:"ry,omitempty"`
	Q        *Quaternion     `json:"q,omitempty"`
	Omega    float32         `json:"omega,omitempty"`
	Hit      float32         `json:"hit,omitempty"`
	ID       string          `json:"id,omitempty"`
	Value    json.RawMessage `json:"value,omitempty"`
	MsgID    string          `json:"msgId,omitempty"`
}

type Handlers struct {
	OnPlayerJoin  func(ev InboundEvent)
	OnPlayerLeave func(ev InboundEvent)
	OnInput       func(ev InboundEvent)
	OnMotion      func(ev InboundEvent)
	OnAction      func(ev InboundEvent)
	OnPrivateAck  func(ev InboundEvent)
}

// Server bridges the browser PartyHost (via ServerBridgeAdapter WebSocket) to Go game logic.
type Server struct {
	handlers Handlers
	upgrader websocket.Upgrader

	mu    sync.RWMutex
	conns map[*websocket.Conn]struct{}
}

func NewServer(h Handlers) *Server {
	return &Server{
		handlers: h,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		conns: make(map[*websocket.Conn]struct{}),
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[PartyPad-Go] upgrade error: %v", err)
		return
	}

	s.mu.Lock()
	s.conns[conn] = struct{}{}
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.conns, conn)
		s.mu.Unlock()
		_ = conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var ev InboundEvent
		if err := json.Unmarshal(data, &ev); err != nil {
			continue
		}
		s.dispatch(ev)
	}
}

func (s *Server) dispatch(ev InboundEvent) {
	switch ev.Type {
	case "player_join", "player_reconnect":
		if s.handlers.OnPlayerJoin != nil {
			s.handlers.OnPlayerJoin(ev)
		}
	case "player_leave":
		if s.handlers.OnPlayerLeave != nil {
			s.handlers.OnPlayerLeave(ev)
		}
	case "input":
		if s.handlers.OnInput != nil {
			s.handlers.OnInput(ev)
		}
	case "motion":
		if s.handlers.OnMotion != nil {
			s.handlers.OnMotion(ev)
		}
	case "action":
		if s.handlers.OnAction != nil {
			s.handlers.OnAction(ev)
		}
	case "private_ack":
		if s.handlers.OnPrivateAck != nil {
			s.handlers.OnPrivateAck(ev)
		}
	}
}

func (s *Server) sendCommand(cmd map[string]any) error {
	payload, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for conn := range s.conns {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			log.Printf("[PartyPad-Go] write error: %v", err)
		}
	}
	return nil
}

// SendPrivate pushes a private text card strictly to one player.
func (s *Server) SendPrivate(playerID, title, body string, secret bool) error {
	return s.sendCommand(map[string]any{
		"cmd":      "send_private",
		"playerId": playerID,
		"title":    title,
		"body":     body,
		"style":    "card",
		"secret":   secret,
	})
}

func (s *Server) ClearPrivate(playerID, msgID string) error {
	return s.sendCommand(map[string]any{
		"cmd":      "clear_private",
		"playerId": playerID,
		"msgId":    msgID,
	})
}

func (s *Server) BroadcastLayout(layout map[string]any) error {
	return s.sendCommand(map[string]any{
		"cmd":    "broadcast_layout",
		"layout": layout,
	})
}

func (s *Server) SetPlayerLayout(playerID string, layout map[string]any) error {
	return s.sendCommand(map[string]any{
		"cmd":      "set_layout",
		"playerId": playerID,
		"layout":   layout,
	})
}

func (s *Server) Vibrate(playerID string, pattern []int) error {
	return s.sendCommand(map[string]any{
		"cmd":      "vibrate",
		"playerId": playerID,
		"pattern":  pattern,
	})
}
