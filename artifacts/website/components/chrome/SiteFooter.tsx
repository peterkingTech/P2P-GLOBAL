import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="cols">
        <div className="col">
          <strong>Understand</strong>
          <Link href="/why-p2p">Why P2P</Link>
          <Link href="/how-it-works">How It Works</Link>
          <Link href="/experience">Experience</Link>
        </div>
        <div className="col">
          <strong>Explore</strong>
          <Link href="/explore/stories">Kingdom Stories</Link>
          <Link href="/explore/missions">Missions</Link>
          <Link href="/explore/wins">Kingdom Wins</Link>
          <Link href="/explore/curriculum">Curriculum</Link>
        </div>
        <div className="col">
          <strong>For</strong>
          <Link href="/for-individuals">Individuals</Link>
          <Link href="/for-families">Families</Link>
          <Link href="/for-churches">Churches</Link>
        </div>
        <div className="col">
          <strong>P2P Global</strong>
          <Link href="/about">About</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/get-the-app">Get the App</Link>
        </div>
      </div>
      <div className="verse">
        <p>
          &ldquo;And what you have heard from me&hellip; entrust to faithful men, who will be able to teach others
          also.&rdquo;
        </p>
        <span>2 Timothy 2:2</span>
      </div>
    </footer>
  );
}
