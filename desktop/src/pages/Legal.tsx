import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Button, Panel } from "../components/ui";
import { pageMotion } from "../animations/motion";

type LegalDocument = "terms" | "privacy";

const documents: Record<LegalDocument, { eyebrow: string; title: string; updated: string; intro: string; sections: Array<[string, string[]]> }> = {
  terms: {
    eyebrow: "LEGAL INFORMATION",
    title: "Terms of Service",
    updated: "Last updated: August 3, 2026",
    intro: "These Terms of Service govern your use of viAI Security Engine, including the desktop application and local security-analysis engine.",
    sections: [
      ["Acceptable Use", ["Use viAI only on devices, files, and environments that you own or are authorized to assess. You are responsible for configuring monitoring, reviewing findings, and protecting any exported reports."]],
      ["Security Findings Are Investigative Guidance", ["viAI performs local static analysis and produces evidence-based recommendations. Its results are not a malware verdict, a guarantee of safety, legal advice, or a replacement for incident-response procedures, endpoint protection, sandboxing, or professional security review.", "Do not rely on viAI as the sole basis for executing, deleting, quarantining, or otherwise acting on a file. Validate significant findings through your organization's approved security process."]],
      ["Local Data and Exports", ["viAI retains analysis evidence, settings, and reports locally to support review. You control whether to export reports and are responsible for handling exported data in accordance with your organization's policies and applicable law."]],
      ["Updates and Third-Party Services", ["The application can check GitHub Releases for updates when you request it. GitHub and other third-party services are governed by their own terms and privacy policies. viAI is not responsible for the availability, content, or practices of external services."]],
      ["No Warranty", ["viAI is provided on an as is and as available basis. To the fullest extent permitted by applicable law, the project makes no warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, or uninterrupted availability."]],
      ["Limitation of Liability", ["To the fullest extent permitted by applicable law, the project contributors will not be liable for indirect, incidental, special, consequential, or punitive damages, or for loss of data, security incidents, or business interruption arising from use of or inability to use viAI."]],
      ["Changes to These Terms", ["These terms may change as the project evolves. Continued use after a published update constitutes acceptance of the updated terms to the extent permitted by law."]],
      ["Contact", ["For questions about these terms, open an issue in the viAI Security Engine repository."]],
    ],
  },
  privacy: {
    eyebrow: "LEGAL INFORMATION",
    title: "Privacy Policy",
    updated: "Last updated: August 3, 2026",
    intro: "viAI Security Engine is designed to analyze files and security evidence on the device where it is installed. This policy describes the privacy practices of the viAI Security Engine desktop application and local analysis engine.",
    sections: [
      ["Information Processed Locally", ["viAI may process file paths, names, hashes, metadata, and static-analysis evidence; local scan history, reports, recommendations, rule matches, and trust indicators; application settings, monitoring preferences, exclusions, and device-security records; and basic device identifiers used to retain local application state.", "This information is stored in the application's local data directory unless you export it, clear it, or remove the application data."]],
      ["No File Uploads or Cloud Analysis", ["viAI does not upload scanned files, file contents, hashes, local reports, or monitoring evidence for cloud analysis. The local engine binds to 127.0.0.1 and is intended to communicate only with the desktop application on the same device."]],
      ["Updates and External Links", ["When you request an application update, the desktop application contacts GitHub Releases to check for and download an available release. Those requests are subject to GitHub's privacy practices and may include standard connection metadata such as your IP address and user agent."]],
      ["Your Choices", ["You can manage local monitoring and data from the desktop application. You can clear stored local data from the History page and export reports when needed. Before exporting reports, review them carefully because exported files may contain file paths, hashes, and security findings."]],
      ["Security", ["viAI uses local storage and local interprocess communication to support its features. No software can guarantee absolute security. Keep your operating system, viAI installation, and access controls up to date."]],
      ["Changes to This Policy", ["This policy may change as the project evolves. The current version is available within the desktop application."]],
      ["Contact", ["For privacy questions or concerns, open an issue in the viAI Security Engine repository."]],
    ],
  },
};

export default function Legal({ document }: { document: LegalDocument }) {
  const navigate = useNavigate();
  const content = documents[document];
  return <motion.div {...pageMotion} className="page-stack legal-page"><header className="legal-hero"><Button className="secondary" onClick={() => navigate(-1)}><ArrowLeft size={16} />Back</Button><div className="legal-emblem"><ShieldCheck size={28} /></div><p className="eyebrow">{content.eyebrow}</p><h2>{content.title}</h2><p>{content.intro}</p><time>{content.updated}</time></header><div className="legal-content">{content.sections.map(([heading, paragraphs]) => <Panel key={heading} className="legal-section"><div className="legal-section-heading"><FileText size={18} /><h3>{heading}</h3></div>{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</Panel>)}</div></motion.div>;
}