/**
 * Edge tests for redactPii: the email, link and phone shapes the core tests do not pin down,
 * what is deliberately left alone, replacement order, placeholder counts and idempotence.
 */
import { describe, expect, it } from "vitest";
import { redactPii } from "../src/lib/intake";

/** How many times `placeholder` appears in `text`. */
function countPlaceholders(text: string, placeholder: string): number {
  return text.split(placeholder).length - 1;
}

describe("redactPii emails", () => {
  it("removes plus-addressed, subdomain and upper-case emails", () => {
    expect(redactPii("mail me+a.b@example.com ok").text).toBe("mail [email removed] ok");
    expect(redactPii("mail a@mail.example.co.uk ok").text).toBe("mail [email removed] ok");
    expect(redactPii("mail USER@EXAMPLE.COM ok").text).toBe("mail [email removed] ok");
  });

  it("leaves adjacent punctuation in the text and counts two emails in one line", () => {
    expect(redactPii("(a@b.com), ok.").text).toBe("([email removed]), ok.");
    const out = redactPii("a@b.com and c@d.org");
    expect(out.text).toBe("[email removed] and [email removed]");
    expect(out.redactions.emails).toBe(2);
  });

  it("does not treat an @ handle without a domain as an email", () => {
    const text = "contact @somehandle today";
    expect(redactPii(text)).toEqual({ text, redactions: { emails: 0, phones: 0, links: 0 } });
  });
});

describe("redactPii links", () => {
  it.each([
    ["http", "see http://example.com/cv end"],
    ["https", "see https://example.com/cv end"],
    ["www", "see www.example.com/cv end"],
    ["bare linkedin", "see linkedin.com/in/x end"],
    ["bare github", "see github.com/x end"],
  ])("removes a %s link", (_label, text) => {
    const out = redactPii(text);
    expect(out.text).toBe("see [link removed] end");
    expect(out.redactions.links).toBe(1);
  });

  it("leaves trailing sentence punctuation in the text", () => {
    expect(redactPii("see https://x.com/a.").text).toBe("see [link removed].");
    expect(redactPii("see https://x.com/a, and more").text).toBe("see [link removed], and more");
    expect(redactPii("see (https://x.com/a)").text).toBe("see ([link removed])");
    expect(redactPii("see https://x.com/a?").text).toBe("see [link removed]?");
  });
});

describe("redactPii phones", () => {
  it.each([
    ["international", "call +44 7911 123456 now"],
    ["dashes", "call 415-555-0134 now"],
    ["dots", "call 415.555.0134 now"],
    ["no separators", "call 09876543210 now"],
  ])("removes a %s phone number", (_label, text) => {
    const out = redactPii(text);
    expect(out.text).toBe("call [phone removed] now");
    expect(out.redactions.phones).toBe(1);
  });

  it("removes a parenthesised area code but leaves the opening bracket behind", () => {
    // The phone pattern starts at the first digit, so the "(" is not part of the match.
    const out = redactPii("call (415) 555-0134 now");
    expect(out.redactions.phones).toBe(1);
    expect(out.text).toBe("call ([phone removed] now");
  });

  it.each([
    ["a four-digit year", "in 2019 we shipped"],
    ["a year range", "worked 2019-2023 hard"],
    ["a short digit run", "call 12 3456 now"],
    ["a version number", "version 1.2.3.4 out"],
    ["an ISO date", "on 2024-03-15 ship"],
  ])("leaves %s alone", (_label, text) => {
    // Short runs never match the phone shape (at least 8 characters); longer ones fail the
    // 9-to-15 digit check in looksLikePhone, so all of these come back unchanged.
    expect(redactPii(text)).toEqual({ text, redactions: { emails: 0, phones: 0, links: 0 } });
  });
});

describe("redactPii order and shape", () => {
  it("documents what happens today to an email inside a link", () => {
    // Emails are replaced first, so "a@b.com" becomes "[email removed]" and the link pass then
    // eats the "[email" half of that placeholder, leaving a stray " removed]" in the text.
    // Both counters still increment, so the counts do not match the placeholders here.
    const out = redactPii("see https://x.com/a@b.com end");
    expect(out.text).toBe("see [link removed] removed] end");
    expect(out.redactions).toEqual({ emails: 1, phones: 0, links: 1 });
  });

  it("counts match the placeholders for ordinary mixed input", () => {
    const out = redactPii("Mail a@b.com, call 415-555-0134, see https://x.com/a and c@d.org.");
    expect(countPlaceholders(out.text, "[email removed]")).toBe(out.redactions.emails);
    expect(countPlaceholders(out.text, "[phone removed]")).toBe(out.redactions.phones);
    expect(countPlaceholders(out.text, "[link removed]")).toBe(out.redactions.links);
    expect(out.redactions).toEqual({ emails: 2, phones: 1, links: 1 });
  });

  it("is idempotent: redacting twice changes nothing the second time", () => {
    const first = redactPii("Mail a@b.com, call 415-555-0134, see https://x.com/a.");
    const second = redactPii(first.text);
    expect(second.text).toBe(first.text);
    expect(second.redactions).toEqual({ emails: 0, phones: 0, links: 0 });
  });

  it("leaves an empty string and a whitespace-only string alone", () => {
    expect(redactPii("")).toEqual({ text: "", redactions: { emails: 0, phones: 0, links: 0 } });
    expect(redactPii("   ")).toEqual({ text: "   ", redactions: { emails: 0, phones: 0, links: 0 } });
  });

  it("handles a full-length input of digits and spaces without backtracking", () => {
    // 6000 characters, the longest text Intake accepts. Bounded quantifiers keep this linear.
    const out = redactPii("12345 67890 ".repeat(500));
    expect(out.text).toContain("[phone removed]");
    expect(out.redactions.emails).toBe(0);
    expect(out.redactions.links).toBe(0);
  });
});
