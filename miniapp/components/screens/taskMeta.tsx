import { AtSign, BadgeCheck, Megaphone, PenLine, RotateCw, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { Task } from "@/lib/api";
import { ic } from "../Common";

export const TASK_ICON: Record<Task["key"], ReactNode> = {
  spin: <RotateCw {...ic} />,
  x_post: <PenLine {...ic} />,
  x_bio: <BadgeCheck {...ic} />,
  x_connect: <AtSign {...ic} />,
  wallet: <Wallet {...ic} />,
  join_channel: <Megaphone {...ic} />,
};

/** X (Twitter) activities are hidden for now. Set to true to bring them back everywhere in the app. */
export const X_ENABLED = false;

const X_TASKS: Task["key"][] = ["x_post", "x_bio", "x_connect"];

/** False for tasks that are hidden in the app right now. */
export function taskVisible(t: Task): boolean {
  return X_ENABLED || !X_TASKS.includes(t.key);
}

export const TASK_ACTION: Record<Task["key"], string> = {
  spin: "Spin",
  x_post: "Add post",
  x_bio: "Mark",
  x_connect: "Connect",
  wallet: "Link",
  join_channel: "Join",
};
