// Where readers can tell the team what they think (GOO-208): a Google Form,
// and two Google Calendar booking pages for a video call, one with times that
// suit the US and one with times that suit Europe.
export const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSc8Afz4rMOvBMekS3hz6uBMcpSfeEEUtmSLzISG2IkNdYfmkA/viewform";

export const BOOK_CALL_URLS: { label: string; url: string }[] = [
  {
    label: "US hours",
    url: "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ3sjH5weBZANv-Gpmk1Ct3ed8GQZD18jm_epiOU1g83-3WXxUlSrulrL3YEaTL4oiDs1MXpethH",
  },
  {
    label: "European hours",
    url: "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ2VVyS-TxZ-BK_exMqst0CBVHPjexMWhrmuNEJlJE4qQwZt2dtVMqAxkhIgheWAB7FkYQ5iPGU3",
  },
];
