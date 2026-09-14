import { CompareColumns } from "@/components/cards/Cards";

export function Scene03WhyP2P() {
  return (
    <section className="scene short" aria-labelledby="scene03-heading">
      <div className="scene-content" style={{ textAlign: "center" }}>
        <p className="eyebrow">Why Peer-to-Peer</p>
        <CompareColumns />
        <h2 id="scene03-heading" className="display-xl" style={{ margin: "32px auto 12px", fontSize: "clamp(22px,3.4vw,36px)" }}>
          Peer-to-peer does not mean <em>everyone is automatically an authority.</em>
        </h2>
        <p className="lede" style={{ margin: "0 auto" }}>
          A Peer Guide is not a pastor, expert, or authority figure — a fellow traveler who walked this path a
          little earlier. Teaching still matters: pastors, teachers, and mature believers carry a role peer-to-peer
          discipleship doesn&rsquo;t replace.
        </p>
        <a href="/why-p2p" className="btn btn-ghost">
          Why P2P →
        </a>
      </div>
    </section>
  );
}
