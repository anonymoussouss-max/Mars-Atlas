import {
  createIcons, Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronDown, CircleCheck, CircleAlert, CirclePlus,
  CircleDot, Clock, Compass, Copy, Crosshair, Eye, FileText, Flag, FlaskConical, Footprints, Info, Layers, LocateFixed, MapPin,
  Maximize, Minus, Moon, Mountain, Navigation2, OctagonAlert, Orbit, Pause, Pencil, Play, Plus, Printer, Radiation, Repeat2, Rocket,
  Route, ScanEye, Search, Share2, ShieldCheck, ShieldPlus, SlidersHorizontal, Sun, Sunrise, Sunset, TentTree, Thermometer, Timer,
  Trash2, TriangleAlert, Truck, Users, Wind, X, CloudFog,
} from "lucide";

const ICONS = {
  Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronDown, CircleCheck, CircleAlert, CirclePlus, CircleDot, Clock,
  Compass, Copy, Crosshair, Eye, FileText, Flag, FlaskConical, Footprints, Info, Layers, LocateFixed, MapPin, Maximize, Minus, Moon,
  Mountain, Navigation2, OctagonAlert, Orbit, Pause, Pencil, Play, Plus, Printer, Radiation, Repeat2, Rocket, Route, ScanEye, Search,
  Share2, ShieldCheck, ShieldPlus, SlidersHorizontal, Sun, Sunrise, Sunset, TentTree, Thermometer, Timer, Trash2, TriangleAlert, Truck,
  Users, Wind, X, CloudFog,
};

export const icon = (name, cls = "") => `<i data-lucide="${name}" class="${cls}"></i>`;
export const refreshIcons = () => createIcons({ icons: ICONS, attrs: { "stroke-width": 1.65 } });

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 3200);
}

export function openDialog(title, html, { eyebrow = "MARS ATLAS / MISSION CONTROL", wide = false } = {}) {
  const dialog = $("#dialog");
  $("#dialog-eyebrow").textContent = eyebrow;
  $("#dialog-content").innerHTML = `<h2>${title}</h2>${html}`;
  dialog.classList.toggle("wide", wide);
  refreshIcons();
  if (!dialog.open) dialog.showModal();
  return dialog;
}
export const closeDialog = () => $("#dialog").open && $("#dialog").close();
