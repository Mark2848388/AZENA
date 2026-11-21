# Azena — English learning classroom prototype

## Included in this build
- Supabase Auth email/password sign-in and sign-up, session restoration and sign-out.
- Cloud class storage, joining classes by code, student vocabulary and progress sync.
- Homework deadlines, submission record and teacher review/feedback panel.
- Richer task types: open response, multiple choice, true/false, fill the gaps, order the words, and match pairs.
- Shared classroom text board, pinned lesson, Vektor lesson-aware explain/check buttons, voice input, and 5 speaking phrases.
- Call controls (camera/mic/chat/PiP), call history and after-call notes.
- Vektor basic Markdown formatting: real bold/italic/headers/list rendering rather than visible Markdown symbols.

## Run
Serve the folder through HTTP (video requires a secure context such as HTTPS or localhost):
```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

## Supabase
The configured project is initialized with the schema and Row Level Security policies. The SQL file is kept for reference/redeployment. Auth email confirmation may be enabled in Supabase settings; if enabled, a new user must confirm email before their first login.

The browser uses the publishable key only. Do not put a service-role key in this app.


## Video calling limitations
PeerJS uses public signaling/STUN and public TURN relay servers as a fallback. They are best-effort and may be rate-limited or unavailable; for dependable production calling, configure a dedicated TURN service with your own credentials. Video calls require camera/mic permission and HTTPS (or localhost). Network/firewall restrictions can prevent peer-to-peer connections even when the code is functioning.

## Notes
This remains a frontend prototype. Some legacy local class data created with demo IDs won't automatically become owned by the signed-in Supabase Auth user; create new classes after registering/logging in. Review submission storage is implemented, but this is not yet a complete normalized production classroom backend or moderation workflow.
