import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'OpenNest live demo',
  description:
    'Talk to an agent that drives a simulated smart home through the OpenNest VM',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  )
}
