const NODES = [
  { label: "Scripture", def: "The foundation everything else is tested against.", top: 50, left: 86.7 },
  { label: "Holy Spirit", def: "Our guide — not a program, a Person.", top: 18.2, left: 68.3 },
  { label: "People", def: "Discipleship happens between people, not screens.", top: 18.2, left: 31.7 },
  { label: "Discipleship", def: "Learning from someone. Helping someone grow.", top: 50, left: 13.3 },
  { label: "Mission", def: "The knowledge of His glory, filling the earth.", top: 81.8, left: 31.7 },
  { label: "Multiplication", def: "One disciple, teaching another, without end.", top: 81.8, left: 68.3 },
];

export function Scene02Center() {
  return (
    <section className="scene short" aria-labelledby="scene02-heading">
      <div className="scene-content">
        <p className="eyebrow">Jesus Is the Center</p>
        <h2 id="scene02-heading" className="visually-hidden">
          Jesus is the center
        </h2>
        <div className="ring-wrap">
          <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
            {NODES.map((n, i) => (
              <line
                key={i}
                x1={50}
                y1={50}
                x2={n.left}
                y2={n.top}
                stroke="rgba(201,214,208,0.18)"
                strokeWidth="0.4"
              />
            ))}
          </svg>
          {NODES.map((n) => (
            <div key={n.label} className="ring-node" style={{ top: `${n.top}%`, left: `${n.left}%` }}>
              <button type="button" aria-describedby={`def-${n.label}`}>
                <span className="dot" />
                <span className="label">{n.label}</span>
              </button>
              <span className="def" id={`def-${n.label}`} role="tooltip">
                {n.def}
              </span>
            </div>
          ))}
          <div className="ring-center">JESUS</div>
        </div>
        <p style={{ textAlign: "center", maxWidth: 520, margin: "28px auto 0", color: "var(--mist-dim)", fontSize: 13.5 }}>
          Scripture. The Holy Spirit. People. Discipleship. Mission. Multiplication — all of it orbits one center.
        </p>
      </div>
    </section>
  );
}
