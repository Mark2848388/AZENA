# Azena — English learning classroom prototype

## Included in this build
- Supabase Auth email/password sign-in and sign-up, session restoration and sign-out.
- Cloud class storage, joining classes by code, student vocabulary and progress sync.
- Homework deadlines, submission record and teacher review/feedback panel.
- Richer task types: open response, multiple choice, true/false, fill the gaps, order the words, and match pairs.
- Shared classroom text board, pinned lesson, Vektor lesson-aware explain/check buttons, voice input, and 5 speaking phrases.
- **PeerJS P2P video calls** (floating PiP) — no external paid services, no API keys, no billing limits.
- Call controls (camera/mic/chat/PiP), call history and after-call notes.
- Vektor basic Markdown formatting.

## Run
Serve the folder through HTTP (video requires a secure context such as HTTPS or localhost):
```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

## Supabase
The configured project is initialized with the schema and Row Level Security policies. The SQL file is kept for reference/redeployment.

The browser uses the publishable key only. Do not put a service-role key in this app.

## Video (PeerJS)
- Fully peer-to-peer via PeerJS + public STUN/TURN.
- Teacher opens the class code first → becomes host.
- Students enter the same class code → connect to the teacher.
- No Edge Function, no API keys, no payment methods required.
- Works best on HTTPS or localhost. Camera/mic permission required.

Limitations of pure P2P: connection quality depends on networks; some mobile networks / strict firewalls may need a dedicated TURN server for production use.

## Notes
This remains a frontend prototype. Create new classes after registering/logging in for proper ownership.
