import {
  BadgePercent, Boxes, Briefcase, Building, Car, CircleEllipsis, Clapperboard, GraduationCap, HeartPulse, Laptop, Megaphone,
  Package, Paperclip, Plane, Receipt, ShoppingBag, ShoppingBasket, Tag, Truck, Users, Utensils, Zap, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils, "shopping-basket": ShoppingBasket, car: Car, receipt: Receipt, "shopping-bag": ShoppingBag,
  clapperboard: Clapperboard, "heart-pulse": HeartPulse, "graduation-cap": GraduationCap, plane: Plane, users: Users,
  "circle-ellipsis": CircleEllipsis, paperclip: Paperclip, boxes: Boxes, package: Package, truck: Truck, megaphone: Megaphone,
  "badge-percent": BadgePercent, laptop: Laptop, building: Building, zap: Zap, briefcase: Briefcase, tag: Tag,
};

export function CategoryIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const I = (icon && ICONS[icon]) || Tag;
  return <I className={className} />;
}
