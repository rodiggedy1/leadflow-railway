import {
  // Command Chat options
  Radio, Antenna, Satellite, Terminal, Layers,
  Cpu, Broadcast, Wifi, Radar, Rss,
  // Customer Service options
  PhoneCall, LifeBuoy, MessageCircle, Inbox, BadgeHelp,
  HeadphonesIcon, HelpCircle, Phone, MessageSquareDot, UserCheck,
  // Lead Management options
  FolderKanban, Target, Crosshair, GitBranch, ListFilter,
  Kanban, Filter, Workflow, Network, PieChart,
  // Lead Chat options
  MessagesSquare, UserRoundSearch, Sparkles, BotMessageSquare, Flame,
  Users, UserSearch, Stars, Bot, Rocket,
  // Operation Logs options
  ClipboardList, ScrollText, Activity, BarChart2, ListChecks,
  FileText, BookOpen, BarChart, LineChart, ClipboardCheck,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

type IconOption = {
  Icon: LucideIcon;
  name: string;
};

type WorkspaceGroup = {
  workspace: string;
  color: string;
  options: IconOption[];
};

const groups: WorkspaceGroup[] = [
  {
    workspace: "Command Chat",
    color: "#6366f1",
    options: [
      { Icon: Radio, name: "Radio" },
      { Icon: Antenna, name: "Antenna" },
      { Icon: Satellite, name: "Satellite" },
      { Icon: Terminal, name: "Terminal" },
      { Icon: Cpu, name: "Cpu" },
    ],
  },
  {
    workspace: "Customer Service",
    color: "#10b981",
    options: [
      { Icon: PhoneCall, name: "PhoneCall" },
      { Icon: LifeBuoy, name: "LifeBuoy" },
      { Icon: MessageCircle, name: "MessageCircle" },
      { Icon: HelpCircle, name: "HelpCircle" },
      { Icon: UserCheck, name: "UserCheck" },
    ],
  },
  {
    workspace: "Lead Management",
    color: "#f59e0b",
    options: [
      { Icon: FolderKanban, name: "FolderKanban" },
      { Icon: Target, name: "Target" },
      { Icon: Workflow, name: "Workflow" },
      { Icon: Network, name: "Network" },
      { Icon: PieChart, name: "PieChart" },
    ],
  },
  {
    workspace: "Lead Chat",
    color: "#ec4899",
    options: [
      { Icon: MessagesSquare, name: "MessagesSquare" },
      { Icon: UserSearch, name: "UserSearch" },
      { Icon: Sparkles, name: "Sparkles" },
      { Icon: Bot, name: "Bot" },
      { Icon: Rocket, name: "Rocket" },
    ],
  },
  {
    workspace: "Operation Logs",
    color: "#3b82f6",
    options: [
      { Icon: ClipboardList, name: "ClipboardList" },
      { Icon: ScrollText, name: "ScrollText" },
      { Icon: Activity, name: "Activity" },
      { Icon: BarChart2, name: "BarChart2" },
      { Icon: ListChecks, name: "ListChecks" },
    ],
  },
];

export default function IconPicker() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white p-8 font-sans">
      <h1 className="text-2xl font-bold mb-2 text-white">Icon Picker</h1>
      <p className="text-gray-400 mb-8 text-sm">Pick your preferred icon for each workspace. Tell me the workspace name + option number (1–5).</p>

      <div className="flex flex-col gap-10">
        {groups.map((group) => (
          <div key={group.workspace}>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: group.color }}>
              {group.workspace}
            </div>
            <div className="flex gap-4">
              {group.options.map((opt, i) => (
                <div
                  key={opt.name}
                  className="flex flex-col items-center gap-2"
                >
                  {/* Rail-style pill */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: "#1a1a1a", border: `1.5px solid ${group.color}33` }}
                  >
                    <opt.Icon size={22} style={{ color: group.color }} strokeWidth={1.5} />
                  </div>
                  <span className="text-[11px] text-gray-500 font-mono">{i + 1}</span>
                  <span className="text-[10px] text-gray-600 max-w-[56px] text-center leading-tight">{opt.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
