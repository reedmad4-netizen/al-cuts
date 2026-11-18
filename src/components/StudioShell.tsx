"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Download,
  Film,
  Home,
  Instagram,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  Radio,
  Scissors,
  Settings,
  X,
} from "lucide-react";
import { useApp } from "./AppProvider";
import { Logo } from "./Logo";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/monitoring", label: "Live Monitoring", icon: Radio },
  { href: "/chat", label: "Chat Activity", icon: MessageSquare },
  { href: "/clips", label: "Generated Clips", icon: Film },
  { href: "/editor", label: "Video Editor", icon: Scissors },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/publishing", label: "Publishing", icon: Instagram },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function StudioShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, wsConnected, jobs, logout } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  const runningJobs = jobs.filter((j) => j.status === "running");

  const initials = user
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "G";

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white border-r border-zinc-200/90">
      <div className="flex h-16 items-center justify-between px-5 border-b border-zinc-100">
        <Link href="/" className="focus:outline-none">
          <Logo size="md" />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  active ? "text-blue-600" : "text-zinc-400"
                }`}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <div className="pt-3 mt-3 border-t border-zinc-100">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 transition"
          >
            <Home className="h-3.5 w-3.5 text-zinc-400" />
            <span>Landing Page</span>
          </Link>
        </div>
      </nav>

      {/* Active FFmpeg Processing Mini Banner */}
      {runningJobs.length > 0 && (
        <div className="mx-3 mb-3 rounded-xl bg-blue-50/80 border border-blue-200 p-3">
          <div className="flex items-center justify-between text-[11px] font-bold text-blue-800">
            <span>FFmpeg Processing</span>
            <span className="font-mono">{runningJobs[0].progress}%</span>
          </div>
          <p className="mt-0.5 text-[11px] text-blue-700 truncate">
            {runningJobs[0].stage}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-blue-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-200"
              style={{ width: `${runningJobs[0].progress}%` }}
            />
          </div>
        </div>
      )}

      {/* User Account Card */}
      <div className="border-t border-zinc-100 p-3">
        {user ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-zinc-50 border border-zinc-200/70 p-2.5">
            <Link
              href="/settings"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: user.avatarColor || "#2563EB" }}
            >
              {initials}
            </Link>
            <Link href="/settings" className="flex-1 min-w-0">
              <p className="text-xs font-bold text-zinc-950 truncate">
                {user.displayName}
              </p>
              <p className="text-[11px] text-zinc-500 truncate">
                {user.isDemoAccount ? "Demo Account" : user.handle}
              </p>
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 transition"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Link
            href="/auth"
            onClick={() => setMobileOpen(false)}
            className="flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 transition"
          >
            <LogIn className="h-3.5 w-3.5" />
            Sign In / Register
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-zinc-950/35 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[82vw] h-full">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 lg:pl-60 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-zinc-200/80">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="lg:hidden rounded-xl border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-50"
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-zinc-950 truncate">
                  {title}
                </h1>
                {subtitle && (
                  <p className="hidden sm:block text-xs text-zinc-500 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Real-time WebSocket connectivity badge */}
              <span
                className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  wsConnected
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-zinc-100 border-zinc-200 text-zinc-500"
                }`}
                title={
                  wsConnected
                    ? "Real-time WebSocket connected (/api/ws)"
                    : "Reconnecting WebSocket..."
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    wsConnected ? "bg-emerald-500" : "bg-zinc-400"
                  }`}
                />
                {wsConnected ? "Realtime WS" : "WS Connecting"}
              </span>

              {actions}
            </div>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
