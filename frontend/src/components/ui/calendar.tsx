import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 bg-white dark:bg-slate-900 rounded-xl", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "space-y-3",
        month_caption: "flex justify-center pt-1 relative items-center mb-2",
        caption_label: "text-sm font-semibold text-slate-800 dark:text-slate-200",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 absolute left-1"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 absolute right-1"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-slate-400 dark:text-slate-500 rounded-md w-8 font-normal text-[0.8rem] text-center",
        week: "flex w-full mt-1",
        day: "h-8 w-8 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 font-normal hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        ),
        range_start:
          "bg-purple-600 text-white rounded-l-md hover:bg-purple-600 focus:bg-purple-600",
        range_end:
          "bg-purple-600 text-white rounded-r-md hover:bg-purple-600 focus:bg-purple-600",
        selected:
          "bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:bg-purple-700",
        today: "font-bold underline text-purple-600 dark:text-purple-400",
        outside: "text-slate-300 dark:text-slate-600 opacity-40",
        disabled: "text-slate-300 dark:text-slate-600 opacity-40",
        range_middle:
          "bg-purple-50 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 rounded-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", chevronClass)} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", chevronClass)} />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
