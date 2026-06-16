export const monitoringConfig = {
  timezone: process.env.TIMEZONE || "America/New_York",
  recipients: (
    process.env.EMAIL_TO || "ddonofrio@thecaseygroup.us,jason@thecaseygroup.us"
  )
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean),
  sender:
    process.env.EMAIL_FROM ||
    "66EMP Alerts <digest@alerts.thecaseygroup.us>",
  includeTerms: [
    "66 Outside the Beltway",
    "I-66 outside the Beltway",
    "66 Express Lanes",
    "I-66 Express Lanes",
    "66 Express Mobility Partners",
    "66 EMP",
    "66EMP",
    "Transform 66 Outside the Beltway",
  ],
  uncertaintyTerms: [
    "I-66",
    "Route 66",
    "Northern Virginia",
    "Fairfax",
    "Prince William",
    "Gainesville",
    "Manassas",
    "Centreville",
    "Haymarket",
    "Vienna",
    "Beltway",
    "I-495",
  ],
  excludeTerms: [
    "66th Street",
    "I-77",
    "I-75",
    "Dan Ryan",
    "Kansas",
    "Charlotte",
    "Route 66 road trip",
    "historic Route 66",
  ],
  weekendCriticalTerms: [
    "fatal",
    "fatality",
    "major crash",
    "closure",
    "closed",
    "lawsuit",
    "tolling issue",
    "payment issue",
    "66 Express Mobility Partners",
    "66 EMP",
    "66EMP",
  ],
};
