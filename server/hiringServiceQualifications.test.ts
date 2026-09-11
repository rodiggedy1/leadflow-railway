import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const applyPagePath = new URL("../client/src/pages/Apply.tsx", import.meta.url);
const hiringRouterPath = new URL("./hiringRouter.ts", import.meta.url);

describe("all-services hiring application", () => {
  it("shows the compact service-team overview while retaining one application CTA", async () => {
    const source = await readFile(applyPagePath, "utf8");

    expect(source).toContain("Now hiring across home services");
    expect(source).toContain("There&rsquo;s more than one way to build your career here.");
    expect(source).toContain("Apply for a service team");
    expect(source).toContain('title: "Cleaning teams"');
    expect(source).toContain('title: "Mounting & assembly"');
    expect(source).toContain('title: "Handyman & repairs"');
    expect(source).toContain('title: "Painting"');
    expect(source).toContain('title: "Outdoor services"');
    expect(source).toContain('title: "Moving & removal"');
  });

  it("collects service qualifications through the existing specialties array and requires one selection", async () => {
    const source = await readFile(applyPagePath, "utf8");
    const router = await readFile(hiringRouterPath, "utf8");

    expect(source).toContain("What services can you confidently provide?");
    expect(source).toContain("Select every service you are qualified and ready to perform.");
    expect(source).toContain("Select at least one service qualification to continue.");
    expect(source).toContain("specialties: formData.specialties");
    expect(router).toContain("specialties: z.array(z.string())");
    expect(router).toContain("specialties: input.specialties.length > 0 ? JSON.stringify(input.specialties) : null");
    expect(router).toContain("Specialties: ${input.specialties.length ? input.specialties.join(\", \") : \"None selected\"}");
  });

  it("uses service-neutral Requirements copy and a generic post-submission next-steps page", async () => {
    const source = await readFile(applyPagePath, "utf8");

    expect(source).toContain("Do you have relevant professional service experience?");
    expect(source).toContain("Tell us about your relevant experience");
    expect(source).toContain("Describe the services you provide");
    expect(source).not.toContain("Do you have professional cleaning experience?");
    expect(source).not.toContain("Tell us about your professional cleaning experience");
    expect(source).toContain("Thank you for applying.");
    expect(source).toContain("What happens next");
    expect(source).toContain("Start your AI interview");
    expect(source).toContain("We also sent the secure interview link by text message.");
    expect(source).not.toContain("Send us a photo of your");
    expect(source).not.toContain("Upload a photo of your cleaning supplies");
  });
});
