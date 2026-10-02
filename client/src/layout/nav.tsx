import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import DocumentScannerOutlinedIcon from '@mui/icons-material/DocumentScannerOutlined';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import ContentPasteGoIcon from '@mui/icons-material/ContentPasteGo';
import type { ReactNode } from 'react';

export interface NavItem { to: string; label: string; icon: ReactNode }
export const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [
    { to: '/', label: 'Dashboard', icon: <DashboardOutlinedIcon /> },
    { to: '/my-day', label: 'My Day', icon: <TodayOutlinedIcon /> },
    { to: '/calendar', label: 'Calendar', icon: <CalendarMonthOutlinedIcon /> },
    { to: '/import', label: 'Paste & Import', icon: <ContentPasteGoIcon /> },
  ] },
  { section: 'Work & money', items: [
    { to: '/jobs', label: 'Jobs', icon: <WorkOutlineIcon /> },
    { to: '/clients', label: 'Clients & contractors', icon: <PeopleOutlineIcon /> },
    { to: '/income', label: 'Income', icon: <PaymentsOutlinedIcon /> },
    { to: '/expenses', label: 'Expenses', icon: <ShoppingCartOutlinedIcon /> },
    { to: '/bills', label: 'Bills', icon: <EventRepeatOutlinedIcon /> },
    { to: '/invoices', label: 'Invoices', icon: <ReceiptLongOutlinedIcon /> },
    { to: '/receipts', label: 'Receipts', icon: <DocumentScannerOutlinedIcon /> },
  ] },
  { section: 'Planning', items: [
    { to: '/budgets', label: 'Budgets', icon: <SavingsOutlinedIcon /> },
    { to: '/reports', label: 'Reports', icon: <AssessmentOutlinedIcon /> },
    { to: '/insights', label: 'Insights', icon: <LightbulbOutlinedIcon /> },
    { to: '/documents', label: 'Documents', icon: <FolderOutlinedIcon /> },
    { to: '/settings', label: 'Settings', icon: <SettingsOutlinedIcon /> },
  ] },
];
