import React from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  MousePointer2,
  Phone,
  Quote,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import "./trust-sections.css";

// Published copy and service facts supplied from https://maidsinblack.com/.
const benefits = [
  {
    icon: UsersRound,
    title: "Experienced teams",
    description: "Trained and background checked",
  },
  {
    icon: ShieldCheck,
    title: "Bonded & insured",
    description: "Peace of mind at home",
  },
  {
    icon: MousePointer2,
    title: "Easy online booking",
    description: "See your price before booking",
  },
  {
    icon: CalendarDays,
    title: "Flexible scheduling",
    description: "One-time or recurring",
  },
  {
    icon: BadgeCheck,
    title: "Satisfaction guaranteed",
    description: "Let us know within 24 hours",
  },
];

// Verbatim published testimonials: https://maidsinblack.com/.
const reviews = [
  {
    name: "Ronda Clarke",
    initials: "RC",
    quote:
      "This is one of the best companies I have had the pleasure of working with. Even if something goes wrong they make it right. My entire floor uses them now.",
  },
  {
    name: "Robin Jones",
    initials: "RJ",
    quote:
      "Been using MIB for 7 years now across two apartments and now my home, and love working with them. Appreciate the great communication and top tier service.",
  },
  {
    name: "Laura Brooks",
    initials: "LB",
    quote:
      "MIB, you guys are amazing. I booked for a last minute cleaning for my birthday and was so thrilled they had availability…the two cleaners who came were rock stars!!!",
  },
  {
    name: "Samantha Rapoza",
    initials: "SR",
    quote:
      "You guys did a great job thanks so much. There was no dog hair in sight and having two big dogs that is a HUGE accomplishment. Thanks to Jessica and team.",
  },
];

// Service facts supplied from https://maidsinblack.com/; no unverified policies.
const faqs = [
  {
    question: "Which cleaning service should I choose?",
    answer:
      "Standard cleaning is for routine upkeep. Deep cleaning gives your home a more thorough clean, while move-out cleaning is for an empty home at the end of a move. Recurring cleaning is available weekly, biweekly, or monthly.",
  },
  {
    question: "Who will be cleaning my home?",
    answer:
      "Your home will be cleaned by trained, background-checked cleaning teams.",
  },
  {
    question: "How many cleaners will come?",
    answer:
      "Most homes are cleaned by a team of two. Team size may be adjusted depending on the size of your home.",
  },
  {
    question: "Can I book a same-day cleaning?",
    answer:
      "Please call 202-888-5362 to confirm same-day availability before booking.",
  },
  {
    question: "Are your teams bonded and insured?",
    answer:
      "Yes. Maids in Black is fully bonded and insured, so you can feel confident welcoming the team into your home.",
  },
  {
    question: "What if I’m not happy with my cleaning?",
    answer:
      "Our 200% satisfaction guarantee means that if you are not satisfied, let us know within 24 hours and we will return to clean again for free.",
  },
];

export default function TrustSections() {
  return (
    <div className="br-trust">
      <section className="br-benefits" aria-label="Why choose Maids in Black">
        <div className="br-trust-container br-benefits-grid">
          {benefits.map(({ icon: Icon, title, description }) => (
            <div className="br-benefit" key={title}>
              <span className="br-benefit-icon">
                <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        className="br-reviews-section"
        aria-labelledby="br-reviews-title"
      >
        <div className="br-trust-container">
          <header className="br-section-heading">
            <p className="br-eyebrow">A little love from our customers</p>
            <h2 id="br-reviews-title">Good people. Great cleanings.</h2>
            <p className="br-section-intro">
              Hear what it’s like to come home to a Maids in Black clean.
            </p>
          </header>
          <div
            className="br-reviews-track"
            role="region"
            aria-label="Customer testimonials; scroll to read more"
            tabIndex={0}
          >
            {reviews.map(review => (
              <figure className="br-review-card" key={review.name}>
                <Quote
                  className="br-review-quote-icon"
                  size={25}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <blockquote>
                  <p>“{review.quote}”</p>
                </blockquote>
                <figcaption>
                  <span className="br-review-avatar" aria-hidden="true">
                    {review.initials}
                  </span>
                  <span className="br-review-person">
                    <strong>{review.name}</strong>
                    <span>Maids in Black customer</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="br-questions-section" aria-labelledby="br-faq-title">
        <div className="br-trust-container br-questions-grid">
          <div className="br-faq">
            <header className="br-faq-heading">
              <p className="br-eyebrow">Good to know</p>
              <h2 id="br-faq-title">
                A few questions,
                <br />
                answered.
              </h2>
              <p className="br-section-intro">
                A little clarity before your next clean.
              </p>
            </header>
            <div className="br-faq-list">
              {faqs.map(faq => (
                <details className="br-faq-item" key={faq.question}>
                  <summary>
                    <span>{faq.question}</span>
                    <ChevronDown
                      size={18}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>

          <aside
            className="br-assurance"
            aria-label="Our guarantee and contact information"
          >
            <div className="br-guarantee-card">
              <span className="br-guarantee-icon">
                <BadgeCheck size={38} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <p className="br-eyebrow">We stand behind our clean</p>
              <h2>
                Our 200%
                <br />
                satisfaction guarantee.
              </h2>
              <p className="br-guarantee-copy">
                Your clean should feel right. If it doesn’t, let us know within
                24 hours and we’ll return to clean again for free.
              </p>
              <div className="br-guarantee-note">
                <CircleCheck size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>A clean you can feel good about.</span>
              </div>
            </div>
            <div className="br-contact-card">
              <span className="br-contact-icon">
                <Phone size={22} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <div>
                <p className="br-eyebrow">Rather talk to a person?</p>
                <h3>We’re just a call away.</h3>
                <a
                  href="tel:+12028885362"
                  aria-label="Call Maids in Black at 202-888-5362"
                >
                  202-888-5362
                </a>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
