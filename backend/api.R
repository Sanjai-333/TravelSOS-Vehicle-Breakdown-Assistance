
# ============================================================
# TravelSOS - Intelligent Vehicle Breakdown Assistance System
# Backend: R + Plumber API
# Persistent Storage: CSV
# ============================================================

if (!requireNamespace("plumber", quietly = TRUE)) {
  install.packages("plumber")
}

library(plumber)

# ------------------------------------------------------------
# 1. FIND PROJECT DIRECTORY
# Ensures the CSV path works even if the terminal's
# current working directory changes.
# ------------------------------------------------------------

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)

if (length(file_arg) > 0) {
  script_path <- normalizePath(
    sub("^--file=", "", file_arg[1]),
    winslash = "/",
    mustWork = TRUE
  )
  project_root <- dirname(dirname(script_path))
} else {
  project_root <- normalizePath(
    getwd(),
    winslash = "/",
    mustWork = TRUE
  )
}

data_dir <- file.path(project_root, "data")
storage_file <- file.path(data_dir, "breakdowns.csv")

if (!dir.exists(data_dir)) {
  dir.create(data_dir, recursive = TRUE)
}

# ------------------------------------------------------------
# 2. MECHANIC DATA
# ------------------------------------------------------------

mechanics <- list(
  list(
    id = 1,
    name = "Arun Auto Care",
    speciality = "Engine Repair",
    service = "Engine Repair",
    distance_km = 4,
    rating = 4.8,
    estimated_cost = 2500
  ),
  list(
    id = 2,
    name = "QuickFix Garage",
    speciality = "Battery Service",
    service = "Battery Service",
    distance_km = 2,
    rating = 4.5,
    estimated_cost = 1200
  ),
  list(
    id = 3,
    name = "Highway Motors",
    speciality = "Tyre Repair",
    service = "Tyre Repair",
    distance_km = 6,
    rating = 4.6,
    estimated_cost = 800
  ),
  list(
    id = 4,
    name = "City Car Clinic",
    speciality = "General Repair",
    service = "General Repair",
    distance_km = 3,
    rating = 4.7,
    estimated_cost = 1800
  )
)

# ------------------------------------------------------------
# 3. CREATE CSV STORAGE IF IT DOES NOT EXIST
# ------------------------------------------------------------

empty_records <- data.frame(
  id = integer(),
  vehicle = character(),
  problem = character(),
  location = character(),
  urgency = character(),
  created_at = character(),
  stringsAsFactors = FALSE
)

if (!file.exists(storage_file)) {
  write.csv(
    empty_records,
    storage_file,
    row.names = FALSE,
    na = ""
  )
}

# ------------------------------------------------------------
# 4. LOAD EXISTING REPORTS FROM CSV
# ------------------------------------------------------------

load_breakdowns <- function() {

  if (!file.exists(storage_file)) {
    return(empty_records)
  }

  records <- tryCatch(
    read.csv(
      storage_file,
      stringsAsFactors = FALSE,
      colClasses = "character",
      na.strings = character(),
      check.names = FALSE
    ),
    error = function(e) {
      stop(
        paste(
          "Could not read breakdown storage file:",
          conditionMessage(e)
        )
      )
    }
  )

  required_columns <- names(empty_records)

  # Validate the CSV structure.
  missing_columns <- setdiff(
    required_columns,
    names(records)
  )

  if (length(missing_columns) > 0) {
    stop(
      paste(
        "The breakdown CSV is missing columns:",
        paste(missing_columns, collapse = ", ")
      )
    )
  }

  records <- records[, required_columns, drop = FALSE]

  records$id <- suppressWarnings(
    as.integer(records$id)
  )

  if (anyNA(records$id)) {
    stop("The breakdown CSV contains invalid report IDs.")
  }

  for (column in c(
    "vehicle",
    "problem",
    "location",
    "urgency",
    "created_at"
  )) {
    records[[column]] <- as.character(records[[column]])
  }

  records
}

breakdowns_df <- load_breakdowns()

# Continue numbering from the largest existing report ID.
next_breakdown_id <- if (nrow(breakdowns_df) > 0) {
  max(breakdowns_df$id) + 1L
} else {
  1L
}

cat("Persistent storage file:", storage_file, "\n")
cat("Previously saved reports:", nrow(breakdowns_df), "\n")


# ------------------------------------------------------------
# 5. SAVE REPORTS TO CSV
# ------------------------------------------------------------

save_breakdowns <- function(records) {

  # Write a temporary file first to reduce the risk of
  # leaving a partially written CSV if writing fails.
  temporary_file <- tempfile(
    pattern = "breakdowns_",
    tmpdir = data_dir,
    fileext = ".csv"
  )

  on.exit(
    if (file.exists(temporary_file)) {
      unlink(temporary_file)
    },
    add = TRUE
  )

  write.csv(
    records,
    temporary_file,
    row.names = FALSE,
    na = ""
  )

  # Replace the old file with the new saved version.
  if (file.exists(storage_file)) {
    if (!file.remove(storage_file)) {
      stop("Could not replace the existing breakdown CSV.")
    }
  }

  if (!file.rename(temporary_file, storage_file)) {
    stop("Could not save the breakdown CSV file.")
  }

  invisible(TRUE)
}


# ------------------------------------------------------------
# 6. CONVERT DATA FRAME ROWS TO JSON-FRIENDLY RECORDS
# ------------------------------------------------------------

records_as_list <- function(records) {

  if (nrow(records) == 0) {
    return(list())
  }

  lapply(seq_len(nrow(records)), function(i) {

    list(
      id = records$id[i],
      vehicle = records$vehicle[i],
      problem = records$problem[i],
      location = records$location[i],
      urgency = records$urgency[i],
      created_at = records$created_at[i]
    )
  })
}


# ------------------------------------------------------------
# 7. CREATE PLUMBER API
# ------------------------------------------------------------

api <- plumber::pr()


# ------------------------------------------------------------
# 8. CORS FILTER
# Allows the Live Server frontend to communicate with R.
# ------------------------------------------------------------

api <- plumber::pr_filter(
  api,
  "cors",
  function(req, res) {

    res$setHeader(
      "Access-Control-Allow-Origin",
      "http://127.0.0.1:5500"
    )

    res$setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    )

    res$setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    )

    if (req$REQUEST_METHOD == "OPTIONS") {
      res$status <- 204
      return("")
    }

    plumber::forward()
  }
)


# ------------------------------------------------------------
# 9. API STATUS
# GET /api/status
# ------------------------------------------------------------

api <- plumber::pr_get(
  api,
  "/api/status",
  function() {

    list(
      project = "TravelSOS",
      status = "online",
      language = "R",
      storage = "CSV",
      saved_reports = nrow(breakdowns_df)
    )
  }
)


# ------------------------------------------------------------
# 10. DASHBOARD SUMMARY
# GET /api/summary
# ------------------------------------------------------------

api <- plumber::pr_get(
  api,
  "/api/summary",
  function() {

    high_priority <- sum(
      tolower(breakdowns_df$urgency) %in% c(
        "high",
        "critical"
      )
    )

    list(
      total_breakdowns = nrow(breakdowns_df),
      total_mechanics = length(mechanics),
      high_priority = as.integer(high_priority)
    )
  }
)


# ------------------------------------------------------------
# 11. GET MECHANICS
# GET /api/mechanics
# ------------------------------------------------------------

api <- plumber::pr_get(
  api,
  "/api/mechanics",
  function() {
    mechanics
  }
)


# ------------------------------------------------------------
# 12. GET SAVED BREAKDOWN RECORDS
# GET /api/breakdowns
# ------------------------------------------------------------

api <- plumber::pr_get(
  api,
  "/api/breakdowns",
  function() {
    records_as_list(breakdowns_df)
  }
)


# ------------------------------------------------------------
# 13. REGISTER AND SAVE A BREAKDOWN
# POST /api/breakdowns
#
# Parameters: vehicle, problem, location, urgency
# ------------------------------------------------------------

api <- plumber::pr_post(
  api,
  "/api/breakdowns",
  function(req, res, vehicle, problem, location, urgency) {

    required_values <- list(
      vehicle = vehicle,
      problem = problem,
      location = location,
      urgency = urgency
    )

    # Check that all required values are present.
    for (field_name in names(required_values)) {

      value <- required_values[[field_name]]

      if (
        is.null(value) ||
        length(value) == 0 ||
        is.na(value[1]) ||
        !nzchar(trimws(as.character(value[1])))
      ) {

        res$status <- 400

        return(
          list(
            success = FALSE,
            message = paste(
              "Missing required field:",
              field_name
            )
          )
        )
      }
    }

    vehicle <- trimws(as.character(vehicle[1]))
    problem <- trimws(as.character(problem[1]))
    location <- trimws(as.character(location[1]))
    urgency <- trimws(as.character(urgency[1]))

    allowed_problems <- c(
      "Engine",
      "Battery",
      "Tyre",
      "General"
    )

    allowed_urgencies <- c(
      "Normal",
      "High",
      "Critical"
    )

    if (!problem %in% allowed_problems) {

      res$status <- 400

      return(
        list(
          success = FALSE,
          message = "Invalid problem category."
        )
      )
    }

    if (!urgency %in% allowed_urgencies) {

      res$status <- 400

      return(
        list(
          success = FALSE,
          message = "Invalid urgency level."
        )
      )
    }

    # Create a new report with a timestamp.
    new_record <- data.frame(
      id = next_breakdown_id,
      vehicle = vehicle,
      problem = problem,
      location = location,
      urgency = urgency,
      created_at = format(
        Sys.time(),
        "%Y-%m-%d %H:%M:%S"
      ),
      stringsAsFactors = FALSE
    )

    # Build the new complete dataset.
    updated_records <- rbind(
      breakdowns_df,
      new_record
    )

    # Save to disk BEFORE reporting success.
    save_result <- tryCatch(
      {
        save_breakdowns(updated_records)
        TRUE
      },
      error = function(e) {
        message(
          "CSV save error: ",
          conditionMessage(e)
        )
        FALSE
      }
    )

    if (!save_result) {

      res$status <- 500

      return(
        list(
          success = FALSE,
          message = "Report could not be saved. Check the data folder and file permissions."
        )
      )
    }

    # Update in-memory data only after the file is saved.
    breakdowns_df <<- updated_records
    next_breakdown_id <<- next_breakdown_id + 1L

    res$status <- 201

    list(
      success = TRUE,
      message = "Breakdown registered and saved successfully.",
      id = new_record$id,
      breakdown = as.list(new_record[1, ])
    )
  }
)


# ------------------------------------------------------------
# 14. MECHANIC RECOMMENDATION
# GET /api/recommend?problem=Engine
# ------------------------------------------------------------

api <- plumber::pr_get(
  api,
  "/api/recommend",
  function(res, problem = "General") {

    problem <- tolower(trimws(as.character(problem[1])))

    if (
      is.na(problem) ||
      !problem %in% c(
        "engine",
        "battery",
        "tyre",
        "general"
      )
    ) {

      res$status <- 400

      return(
        list(
          success = FALSE,
          message = "Choose Engine, Battery, Tyre, or General."
        )
      )
    }

    recommended_mechanic <- switch(
      problem,
      engine = mechanics[[1]],
      battery = mechanics[[2]],
      tyre = mechanics[[3]],
      general = mechanics[[4]]
    )

    list(
      success = TRUE,
      problem = problem,
      recommendation = recommended_mechanic
    )
  }
)


# ------------------------------------------------------------
# 15. START SERVER
# ------------------------------------------------------------

cat("\n")
cat("========================================\n")
cat(" TravelSOS API Started\n")
cat("========================================\n")
cat("API:     http://127.0.0.1:8000\n")
cat("Status:  http://127.0.0.1:8000/api/status\n")
cat("Storage: ", storage_file, "\n")
cat("Reports: ", nrow(breakdowns_df), "\n")
cat("========================================\n\n")

api$run(
  host = "127.0.0.1",
  port = 8000,
  docs = FALSE
)
