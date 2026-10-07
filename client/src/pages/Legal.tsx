import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardContent, Divider, Link, Stack, Typography } from '@mui/material';
import { api } from '../api/client';

/** Shown on the pages below. Change this date whenever the wording changes. */
const UPDATED = '7 October 2026';
const APP = 'Personal Tracker';

interface PublicInfo { google: boolean; contactEmail?: string; operatorName?: string }
const useInfo = () => useQuery({ queryKey: ['auth-providers'], queryFn: () => api<PublicInfo>('/auth/providers'), staleTime: 5 * 60 * 1000, retry: false });

const H = ({ children }: { children: ReactNode }) => <Typography variant="h6" component="h2" sx={{ mt: 3, mb: 1 }}>{children}</Typography>;
const P = ({ children }: { children: ReactNode }) => <Typography variant="body1" sx={{ mb: 1.5, lineHeight: 1.65 }}>{children}</Typography>;
const L = ({ items }: { items: ReactNode[] }) => (
  <Box component="ul" sx={{ mt: 0, mb: 1.5, pl: 3, '& li': { mb: 0.75, lineHeight: 1.6 } }}>{items.map((x, i) => <Typography key={i} component="li" variant="body1">{x}</Typography>)}</Box>
);

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 2, sm: 5 }, px: 2 }}>
      <Card sx={{ maxWidth: 820, mx: 'auto' }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 5 } }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 3 }}>
            <Box component="img" src="/favicon.svg" alt="" sx={{ width: 30, height: 30 }} />
            <Link component={RouterLink} to="/" underline="none" color="inherit"><Typography variant="subtitle1" fontWeight={700}>{APP}</Typography></Link>
          </Stack>
          <Typography variant="h4" component="h1" sx={{ fontSize: { xs: 26, sm: 34 } }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Last updated {UPDATED}</Typography>
          {children}
          <Divider sx={{ my: 3 }} />
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Link component={RouterLink} to="/privacy">Privacy policy</Link>
            <Link component={RouterLink} to="/terms">Terms of service</Link>
            <Link component={RouterLink} to="/login">Log in</Link>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

function Contact({ info }: { info?: PublicInfo }) {
  return info?.contactEmail
    ? <>email <Link href={`mailto:${info.contactEmail}`}>{info.contactEmail}</Link></>
    : <>use the support email address shown on the sign-in screen</>;
}

export function PrivacyPage() {
  const info = useInfo().data;
  const who = info?.operatorName || `the person who runs this copy of ${APP}`;
  return (
    <Page title="Privacy policy">
      <P>{APP} is a personal app for keeping track of work, income, expenses, bills, invoices and day-to-day tasks. This policy explains what the app stores, what it does with it, and the choices you have. The app is run by {who} (“we”, “us”).</P>

      <H>What the app stores</H>
      <L items={[
        <><b>Account details</b> — your name, email address and a scrambled (hashed) form of your password. If you sign in with Google, your Google account’s name, email address and Google account ID instead of a password.</>,
        <><b>What you enter</b> — jobs and shifts, clients and contractors, addresses, income, expenses, bills, invoices, budgets, saving goals, tasks, notes and settings.</>,
        <><b>Files you upload</b> — receipt photos, roster screenshots and documents, and the text read from them.</>,
        <><b>Technical records</b> — a sign-in cookie, a log of changes you make to your own records (shown to you in Settings), and, if you turn on notifications, the address your browser gives us to deliver them.</>,
      ]} />
      <P>We do not collect data for advertising, we do not use analytics or tracking tools, and we do not sell or rent your information to anyone.</P>

      <H>How it is used</H>
      <P>Your information is used only to run the app for you: to show your schedule and money, work out totals and reminders, create invoices and reports, and send the notifications and emails you have switched on.</P>

      <H>Google account access</H>
      <P>Connecting a Google account is optional. If you do, the app asks only for the access it needs:</P>
      <L items={[
        <><b>Sign in with Google</b> (name, email address, profile) — to identify you and create or open your account.</>,
        <><b>Google Calendar events</b> — to add, update and remove the jobs, appointments, bills and invoice dates you choose to sync, and to show your calendar’s events inside the app.</>,
        <><b>Google Drive, files created by this app only</b> — to keep copies of your invoices, receipts and documents in a folder in your own Drive. The app cannot see any other file in your Drive.</>,
        <><b>Send email as you (Gmail)</b> — to send password-reset links and the daily summary to your own address. The app cannot read your mail.</>,
      ]} />
      <P>Access tokens from Google are stored encrypted. Information received from Google is used only for the features above; it is not used for advertising, is not shared with anyone else, and no person reads it except where you ask for help, it is needed for security, or the law requires it.</P>
      <P>{APP}’s use and transfer of information received from Google APIs to any other app adheres to the <Link href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</Link>, including the Limited Use requirements.</P>
      <P>You can disconnect Google at any time in Settings → Integrations, or remove the app’s access from your Google account at <Link href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</Link>.</P>

      <H>Other services the app relies on</H>
      <P>Some information passes through other companies’ services so the app can work:</P>
      <L items={[
        <><b>Hosting and database</b> — the app runs on Render and its database is hosted by MongoDB Atlas. Your records are stored there.</>,
        <><b>Maps</b> — if you turn on Distance &amp; travel, job addresses and your home address are sent to OpenStreetMap-based services (or OpenRouteService) to find them on the map and work out driving routes. Your name is not sent.</>,
        <><b>Notifications</b> — if you turn on phone or computer notifications, the notification text passes through your browser maker’s delivery service (for example Google, Apple or Mozilla).</>,
        <><b>Email</b> — emails are sent through your connected Gmail account or the mail service configured for the app.</>,
        <><b>News</b> — the News page requests public news feeds and article pages. Only the topic or article address is sent, nothing about you.</>,
      ]} />
      <P>Reading the text in receipts and roster photos happens on the app’s own server; the images are not sent to an outside service. Servers used by these providers may be located outside Australia.</P>

      <H>Cookies</H>
      <P>The app uses one essential cookie to keep you signed in, and a small amount of storage in your browser for preferences and for loading while offline. There are no advertising or tracking cookies.</P>

      <H>Keeping it safe</H>
      <P>Connections to the app are encrypted (https), passwords are stored hashed, Google tokens are stored encrypted, and each account can only see its own records. No system is perfectly secure, so please use a strong password and keep your devices locked.</P>

      <H>Keeping and deleting your information</H>
      <P>Your information is kept for as long as you keep your account. You can change or delete individual records at any time, and Settings → Account → Reset everything permanently deletes all of your records and files. To have the account itself removed as well, <Contact info={info} /> and it will be deleted along with any remaining data.</P>

      <H>Your choices</H>
      <P>You can see and correct what the app holds about you from inside the app, download reports of it, disconnect Google, turn off notifications and email, and ask for your account to be deleted.</P>

      <H>Children</H>
      <P>The app is not intended for children under 16.</P>

      <H>Changes to this policy</H>
      <P>If this policy changes, the new version will be posted on this page with a new date.</P>

      <H>Contact</H>
      <P>Questions about privacy or your information: <Contact info={info} />.</P>
    </Page>
  );
}

export function TermsPage() {
  const info = useInfo().data;
  const who = info?.operatorName || `the person who runs this copy of ${APP}`;
  return (
    <Page title="Terms of service">
      <P>These terms apply when you use {APP} (“the app”), which is run by {who} (“we”, “us”). By creating an account or using the app you agree to them. If you don’t agree, please don’t use the app.</P>

      <H>What the app is</H>
      <P>The app is a personal organiser for work, income, expenses, bills, invoices and tasks. It is provided free of charge, as it is, for personal use.</P>

      <H>Your account</H>
      <L items={[
        'Give accurate details when you sign up and keep your password to yourself.',
        'You are responsible for what happens under your account. Tell us if you think someone else has got into it.',
        'You must be at least 16 to use the app.',
      ]} />

      <H>Your content</H>
      <P>Everything you enter or upload stays yours. You allow the app to store and process it only so that it can provide its features to you. You are responsible for having the right to store the information you put in, including details about your clients, and for keeping your own copies of anything important.</P>

      <H>Acceptable use</H>
      <L items={[
        'Don’t use the app for anything unlawful or to store material you have no right to hold.',
        'Don’t try to get into other people’s accounts, disrupt the app, or get around its security.',
        'Don’t use automated tools to overload it.',
      ]} />

      <H>Not professional advice</H>
      <P>The figures, forecasts, “should I buy it” answers, hours tracking, kilometre log, tax-related estimates and reminders in the app are worked out from what you enter and are a guide only. They are not financial, tax, legal or immigration advice. Check anything important with a qualified adviser or the relevant authority before relying on it. Invoices and reports produced by the app are your responsibility to check before sending.</P>

      <H>Other services</H>
      <P>The app can connect to services run by others, such as Google (sign-in, Calendar, Drive, Gmail), map services and news publishers. Your use of those services is covered by their own terms and privacy policies, and we are not responsible for them. Headlines and article summaries come from their publishers and remain theirs.</P>

      <H>Availability and changes</H>
      <P>We try to keep the app working but don’t promise it will always be available, free of errors or keep every feature. It may be changed, paused or closed down. Where we reasonably can, we will give notice before closing it so you can take a copy of your records.</P>

      <H>Ending your use</H>
      <P>You can stop using the app at any time and delete your records in Settings. We may suspend or close an account that breaks these terms or puts the app or other people at risk.</P>

      <H>Liability</H>
      <P>To the extent the law allows, the app is provided without warranties of any kind, and we are not liable for loss of data, loss of income or profit, missed payments or deadlines, or any indirect loss arising from using or being unable to use the app. Nothing in these terms removes rights you have under the Australian Consumer Law or other laws that can’t be excluded.</P>

      <H>Privacy</H>
      <P>How your information is handled is explained in the <Link component={RouterLink} to="/privacy">Privacy policy</Link>.</P>

      <H>Changes to these terms</H>
      <P>If these terms change, the new version will be posted on this page with a new date. Continuing to use the app after that means you accept the changes.</P>

      <H>Governing law</H>
      <P>These terms are governed by the laws of Australia.</P>

      <H>Contact</H>
      <P>Questions about these terms: <Contact info={info} />.</P>
    </Page>
  );
}
