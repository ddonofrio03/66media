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
  // Parent / operator companies behind the I-66 concession. Coverage that
  // mentions these but NOT the facility directly is routed to "Related Stories"
  // — and only kept when it also ties back to our corridor (see
  // operatorContextTerms), so European/airport/Polish corporate news is dropped.
  operatorEntities: [
    "Ferrovial",
    "Cintra",
    "Meridiam",
    "FAM Construction",
    "Ferrovial Construction",
  ],
  // The "tie back to our corridor" gate for operator-entity matches.
  operatorContextTerms: [
    "i-66",
    "interstate 66",
    "outside the beltway",
    "66 express",
    "express lanes",
    "managed lanes",
    "virginia",
    "northern virginia",
    "nova",
    "fairfax",
    "prince william",
    "gainesville",
    "manassas",
    "centreville",
    "haymarket",
    "washington",
    "d.c.",
    "toll road",
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
