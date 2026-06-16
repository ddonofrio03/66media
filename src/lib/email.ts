import { monitoringConfig } from "@/lib/monitoring-config";

export async function sendEmail({
  subject,
  html,
  text,
}: {
  subject: string;
  html: string;
  text: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return {
      skipped: true,
      reason: "RESEND_API_KEY is not configured.",
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: monitoringConfig.sender,
      to: monitoringConfig.recipients,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend send failed: ${response.status} ${errorText}`);
  }

  return {
    skipped: false,
    data: await response.json(),
  };
}
