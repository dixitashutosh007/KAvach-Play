import Link from "next/link";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#022c22] text-white/80 p-6 sm:p-12 font-sans overflow-y-auto">
      <div className="max-w-3xl mx-auto glass border border-white/10 rounded-3xl p-8 sm:p-12 shadow-2xl backdrop-blur-xl">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#10b981] mb-2 uppercase tracking-wide">
          Privacy Policy
        </h1>
        <p className="text-white/50 text-sm font-semibold uppercase tracking-widest mb-10 pb-4 border-b border-white/10">
          Kavach Play
        </p>

        <div className="space-y-8 text-sm leading-relaxed max-w-none">
          <section>
            <h2 className="text-xl font-bold text-white mb-3">
              1. Introduction
            </h2>
            <p>
              Welcome to Kavach Play. We are committed to protecting your
              personal information and your right to privacy. This Privacy
              Policy explains how we collect, use, and share your information
              when you use our application.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">
              2. Information We Collect
            </h2>
            <p className="mb-2">
              We collect personal information that you voluntarily provide to us
              when you register on the application, including:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-white/70">
              <li>
                Name, email address, and profile picture (via Google
                Authentication)
              </li>
              <li>Contact information such as mobile number</li>
              <li>
                Emergency contact details and blood group for safety purposes
              </li>
              <li>Locality and other demographic details</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">
              3. How We Use Your Information
            </h2>
            <p className="mb-2">
              We use the personal information collected via our application for
              a variety of sports management purposes described below:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-white/70">
              <li>To facilitate account creation and logon process</li>
              <li>To manage player rosters and team assignments</li>
              <li>
                To contact you regarding match fixtures, events, or club
                notifications
              </li>
              <li>To display leaderboards and match statistics</li>
              <li>
                To ensure player safety during events using emergency contact
                forms
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">
              4. Information Sharing and Disclosure
            </h2>
            <p>
              We do not share, sell, rent, or trade your information with any
              third parties for their promotional purposes. Your information is
              visible to Club Administrators for management purposes and to
              other authenticated club members on team rosters and leaderboards.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">
              5. Data Security
            </h2>
            <p>
              We aim to protect your personal information through a system of
              organizational and technical security measures. Your data is
              stored securely using Google Cloud and Firebase infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">
              6. User Consent
            </h2>
            <p>
              By using our application, you consent to our Privacy Policy. If
              you do not agree with the terms outlined in this policy, please do
              not use our portal.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Contact Us</h2>
            <p>
              If you have questions or comments about this policy, you may email
              the club administration at{" "}
              <a
                href="mailto:dixitashutosh007@gmail.com"
                className="text-[#10b981] hover:underline"
              >
                dixitashutosh007@gmail.com
              </a>
              .
            </p>
          </section>

          <div className="pt-8 mt-10 border-t border-white/10 flex justify-center">
            <Link
              href="/"
              className="inline-block bg-[#10b981]/10 text-[#10b981] px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-[#10b981]/20 transition border border-[#10b981]/20"
            >
              Return to Application
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
