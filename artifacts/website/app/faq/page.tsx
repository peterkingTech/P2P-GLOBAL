import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { FAQ_ITEMS } from "@/lib/content/faq";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers to common questions about P2P Global Discipleship Network — what it is, who it's for, and how it relates to the local church.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title={<>Questions people <em>actually ask.</em></>}
        light
      />
      <section className="scene light short" aria-labelledby="faq-heading">
        <div className="scene-content prose">
          <h2 id="faq-heading" className="visually-hidden">
            Frequently asked questions
          </h2>
          <div className="faq-list">
            {FAQ_ITEMS.map((item) => (
              <Reveal key={item.question}>
                <details className="faq-item">
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="scene short" aria-labelledby="faq-cta-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="faq-cta-heading" className="visually-hidden">
            Continue
          </h2>
          <Reveal>
            <a href="/get-the-app" className="btn btn-primary">
              Get the App
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
