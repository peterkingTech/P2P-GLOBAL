import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "P2P Global Discipleship Network";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#081310",
          backgroundImage:
            "radial-gradient(ellipse 900px 420px at 15% -10%, rgba(29,158,117,0.35), transparent 60%), radial-gradient(ellipse 700px 380px at 90% 10%, rgba(201,151,62,0.22), transparent 55%)",
        }}
      >
        <div
          style={{
            fontSize: 22,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: "#e0b45f",
            fontWeight: 700,
            marginBottom: 28,
          }}
        >
          Peer to Peer
        </div>
        <div
          style={{
            fontSize: 76,
            color: "#eee9dd",
            fontWeight: 700,
            lineHeight: 1.05,
            maxWidth: 980,
          }}
        >
          Global Discipleship Network
        </div>
        <div style={{ fontSize: 30, color: "#a9b8b0", marginTop: 36, fontStyle: "italic", maxWidth: 900 }}>
          Everyone is learning from someone. Everyone can help someone grow.
        </div>
      </div>
    ),
    { ...size }
  );
}
