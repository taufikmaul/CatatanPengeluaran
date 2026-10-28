import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  RefreshCw,
  X,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getBackgroundJobs, cancelBackgroundJob } from "@/lib/api";
import { BackgroundJob } from "@/types";
import { toast } from "sonner";

export function BackgroundQueuePopover() {
  const queryClient = useQueryClient();

  const { data: jobs = [] } = useQuery<BackgroundJob[]>({
    queryKey: ["background-jobs"],
    queryFn: () => getBackgroundJobs({ limit: 15 }),
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActive = data?.some(
        (j) => j.status === "running" || j.status === "queued"
      );
      return hasActive ? 2000 : 10000;
    },
  });

  const activeJobs = jobs.filter(
    (j) => j.status === "running" || j.status === "queued"
  );
  const activeCount = activeJobs.length;

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => cancelBackgroundJob(jobId),
    onSuccess: () => {
      toast.success("Tugas latar belakang dibatalkan");
      queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal membatalkan tugas");
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return (
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 border-blue-200 text-[10px] gap-1 font-medium">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            Berjalan
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="outline" className="text-slate-600 dark:text-slate-400 text-[10px] gap-1 font-medium">
            <Clock className="w-2.5 h-2.5" />
            Antre
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border-emerald-200 text-[10px] gap-1 font-medium">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Selesai
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200 border-rose-200 text-[10px] gap-1 font-medium">
            <AlertCircle className="w-2.5 h-2.5" />
            Gagal
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="text-slate-400 text-[10px] gap-1 font-medium">
            <XCircle className="w-2.5 h-2.5" />
            Dibatalkan
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`relative h-9 w-9 p-0 rounded-xl border-slate-200 dark:border-slate-800 transition-colors ${
            activeCount > 0
              ? "text-blue-600 bg-blue-50/50 border-blue-300 dark:bg-blue-950/30 dark:border-blue-800"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          }`}
          title="Antrean & Aksi Latar Belakang"
        >
          {activeCount > 0 ? (
            <RefreshCw className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
          ) : (
            <Layers className="w-4 h-4" />
          )}
          {activeCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white shadow-xs animate-pulse">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-88 rounded-2xl border border-slate-200 dark:border-slate-800 p-0 shadow-xl overflow-hidden bg-white dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Antrean Tugas Latar Belakang
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Audit data & penggabungan asinkron
              </p>
            </div>
          </div>
          {activeCount > 0 ? (
            <Badge className="bg-blue-600 text-white text-[10px] font-semibold">
              {activeCount} Berjalan
            </Badge>
          ) : (
            <span className="text-[10px] text-slate-400 font-medium">
              Tidak ada antrean aktif
            </span>
          )}
        </div>

        {/* Job List */}
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 p-1">
          {jobs.length === 0 ? (
            <div className="py-8 text-center space-y-1.5">
              <Layers className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Belum ada tugas latar belakang
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 max-w-xs mx-auto">
                Tugas audit besar dan penggabungan item akan diproses di sini tanpa membuat aplikasi macet.
              </p>
            </div>
          ) : (
            jobs.map((job) => {
              const isActive = job.status === "running" || job.status === "queued";
              return (
                <div
                  key={job.id}
                  className="p-3 text-xs space-y-1.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors rounded-xl"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {job.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {job.progress_message}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {getStatusBadge(job.status)}
                      {isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cancelMutation.mutate(job.id)}
                          disabled={cancelMutation.isPending}
                          className="h-6 w-6 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md"
                          title="Batalkan Tugas"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar for running task */}
                  {job.status === "running" && (
                    <div className="space-y-1 pt-1">
                      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(5, job.progress)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>{job.progress}%</span>
                        {job.duration_seconds && <span>{job.duration_seconds}s</span>}
                      </div>
                    </div>
                  )}

                  {/* Error display if failed */}
                  {job.status === "failed" && job.error && (
                    <div className="text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50/80 dark:bg-rose-950/30 p-1.5 rounded-lg font-mono break-words">
                      {job.error}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
