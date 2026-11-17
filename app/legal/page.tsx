import React from "react";
import Link from "next/link";

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-[#F6F7F9] text-text-primary p-6 md:p-12 font-sans overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-8 bg-surface border border-border rounded-3xl p-8 sm:p-12 shadow-sm">
        <div>
          <h1 className="text-3xl font-extrabold text-[#A30F2D] uppercase tracking-wide">
            Legal & Policies
          </h1>
          <p className="text-text-muted text-sm font-semibold uppercase tracking-widest mt-1">
            KAvach Cricket Club
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-text-primary border-b border-border pb-2">
            Privacy Policy
          </h2>
          <p className="text-xs text-text-muted">Effective Date: June 19, 2026</p>

          <div className="space-y-4 text-sm text-text-secondary leading-relaxed">
            <p>
              <strong className="text-text-primary">1. Introduction</strong>
              <br />
              Welcome to KAvach Cricket Club App. We are committed to protecting
              your personal data and respecting your privacy. This Privacy
              Policy outlines how we collect, use, and share information about
              you when you use our application. This policy complies with the
              Information Technology Act, 2000, and the reasonable security
              practices and procedures and sensitive personal data or
              information rules, 2011, and the Digital Personal Data Protection
              Act, 2023 of India.
            </p>
            <p>
              <strong className="text-text-primary">2. Information We Collect</strong>
              <br />
              - <strong>Personal Information:</strong> Name, phone number, email
              address, profile picture, and payment transaction details.
              <br />
              - <strong>Usage Data:</strong> Information on how you interact
              with our app, including match participation, financials, and
              application preferences.
            </p>
            <p>
              <strong className="text-text-primary">3. How We Use Your Information</strong>
              <br />
              We use your data to:
              <br />
              - Provide, operate, and maintain the application.
              <br />
              - Manage club memberships, match scheduling, and fee tracking.
              <br />
              - Send administrative and promotional communications.
              <br />
              - Facilitate account authentication via third-party services (e.g.,
              Google Sign-In, Phone OTP).
            </p>
            <p>
              <strong className="text-text-primary">4. Data Sharing and Disclosure</strong>
              <br />
              We do not sell your personal data. We may share information with:
              <br />
              - Service providers who perform services on our behalf (e.g.,
              database hosting, analytics).
              <br />
              - Legal authorities when required by law or to protect our rights.
            </p>
            <p>
              <strong className="text-text-primary">5. Data Security</strong>
              <br />
              We implement reasonable security practices to protect your data
              against unauthorized access, alteration, disclosure, or
              destruction. However, no method of transmission over the internet
              or electronic storage is 100% secure.
            </p>
            <p>
              <strong className="text-text-primary">6. User Rights</strong>
              <br />
              You have the right to access, correct, or delete your personal
              data. You can exercise these rights by contacting the club
              administrators.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-text-primary border-b border-border pb-2">
            Terms and Conditions
          </h2>
          <p className="text-xs text-text-muted">Effective Date: June 19, 2026</p>

          <div className="space-y-4 text-sm text-text-secondary leading-relaxed">
            <p>
              <strong className="text-text-primary">1. Acceptance of Terms</strong>
              <br />
              By accessing or using the KAvach Cricket Club App, you agree to be
              bound by these Terms and Conditions. If you do not agree to these
              terms, please do not use the application.
            </p>
            <p>
              <strong className="text-text-primary">2. User Accounts</strong>
              <br />
              You are responsible for maintaining the confidentiality of your
              account credentials. You agree to accept responsibility for all
              activities that occur under your account.
            </p>
            <p>
              <strong className="text-text-primary">3. Code of Conduct</strong>
              <br />
              Users must use the app for lawful purposes only. Harassment,
              abusive language, or uploading false transaction information will
              result in immediate suspension of your account and club
              membership.
            </p>
            <p>
              <strong className="text-text-primary">4. Fees and Payments</strong>
              <br />
              The app allows tracking of club fees, match fees, and other
              payments. Users are obligated to ensure all recorded transactions
              are accurate. Any disputes regarding payments should be raised
              with the club administrators.
            </p>
            <p>
              <strong className="text-text-primary">5. Limitation of Liability</strong>
              <br />
              The application is provided &quot;as is&quot; and &quot;as available&quot;. We shall
              not be liable for any indirect, incidental, special, consequential,
              or punitive damages arising out of your use of the app or
              participation in club events.
            </p>
            <p>
              <strong className="text-text-primary">6. Changes to Terms</strong>
              <br />
              We reserve the right to modify these terms at any time. Your
              continued use of the app following any changes constitutes your
              acceptance of the new terms.
            </p>
            <p>
              <strong className="text-text-primary">7. Governing Law</strong>
              <br />
              These Terms shall be governed by and construed in accordance with
              the laws of India. Any disputes arising under these Terms shall be
              subject to the exclusive jurisdiction of the courts located in
              India.
            </p>
          </div>
        </section>

        <div className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-text-muted">
          <p>
            For legal or privacy inquiries, contact the club administrators.
          </p>
          <Link
            href="/"
            className="inline-block bg-[#A30F2D]/10 text-[#A30F2D] px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-[#A30F2D]/20 transition border border-[#A30F2D]/20"
          >
            Return to Application
          </Link>
        </div>
      </div>
    </div>
  );
}
