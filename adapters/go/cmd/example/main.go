package main

import (
	"fmt"
	"log"
	"net/http"

	"partypad-go-adapter/partypad"
)

func main() {
	var srv *partypad.Server
	srv = partypad.NewServer(partypad.Handlers{
		OnPlayerJoin: func(ev partypad.InboundEvent) {
			log.Printf("[JOIN] %s (%s) slot=%d", ev.Name, ev.PlayerID, ev.Slot)
			_ = srv.SendPrivate(
				ev.PlayerID,
				"你的秘密身份",
				fmt.Sprintf("欢迎 %s，你是 #%d 号玩家（按住查看防偷窥）", ev.Name, ev.Slot+1),
				true,
			)
		},
		OnInput: func(ev partypad.InboundEvent) {
			if ev.Buttons != 0 {
				log.Printf("[INPUT] %s buttons=0x%x stick=(%.2f, %.2f)", ev.PlayerID, ev.Buttons, ev.LX, ev.LY)
			}
		},
		OnMotion: func(ev partypad.InboundEvent) {
			if ev.Hit > 0 {
				log.Printf("[SWING] %s peak=%.2f rad/s", ev.PlayerID, ev.Hit)
				_ = srv.Vibrate(ev.PlayerID, []int{35})
			}
		},
		OnAction: func(ev partypad.InboundEvent) {
			log.Printf("[ACTION] %s %s=%s", ev.PlayerID, ev.ID, string(ev.Value))
		},
		OnPrivateAck: func(ev partypad.InboundEvent) {
			log.Printf("[ACK] %s received %s", ev.PlayerID, ev.MsgID)
		},
	})

	http.Handle("/partypad", srv)
	log.Println("PartyPad Go bridge listening on ws://localhost:8765/partypad")
	log.Fatal(http.ListenAndServe(":8765", nil))
}
