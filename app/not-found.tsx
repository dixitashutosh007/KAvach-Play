"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center px-4">
      <h2 className="text-2xl font-bold mb-4">404 - Page Not Found</h2>
      <p className="mb-6">We could not find the page you were looking for.</p>
      <Link href="/" className="px-6 py-2 bg-blue-600 text-white rounded-md">
        Return Home
      </Link>
    </div>
  );
}
