use clap::{Parser, Subcommand};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tagmark::{AssignmentState, BookmarkEdit, Collection, Result};

#[derive(Parser)]
#[command(version, about = "Manage a private TagMark collection")]
struct Cli {
    #[arg(long, global = true, default_value = "collection.json")]
    collection: PathBuf,
    #[command(subcommand)]
    command: Action,
}

#[derive(Subcommand)]
enum Action {
    /// Create a new, empty collection without replacing an existing file.
    Init,
    /// Save an HTTP(S) URL or return the bookmark already at that URL.
    Save {
        url: String,
        #[arg(long, default_value = "")]
        title: String,
    },
    /// List active bookmarks, or only deleted bookmarks with --trash.
    List {
        #[arg(long)]
        trash: bool,
    },
    /// Move a bookmark to Trash, keeping its identity and content.
    Delete { id: String },
    /// Explicitly restore a bookmark from Trash.
    Restore { id: String },
    /// Create an English tag with its own definition and optional tagging rules.
    TagCreate {
        name: String,
        #[arg(long)]
        definition: String,
        #[arg(long)]
        inclusion: Option<String>,
        #[arg(long)]
        exclusion: Option<String>,
        #[arg(long)]
        examples: Option<String>,
    },
    /// List tags, definitions and their field protection as JSON.
    Tags,
    /// Manually add and protect one bookmark-tag association.
    TagAdd { bookmark_id: String, tag_id: String },
    /// Explicitly reject and protect one bookmark-tag association.
    TagReject { bookmark_id: String, tag_id: String },
    /// Edit only the supplied definition or rule fields, protecting each changed field.
    TagEdit {
        id: String,
        #[arg(long)]
        definition: Option<String>,
        #[arg(long)]
        inclusion: Option<String>,
        #[arg(long)]
        exclusion: Option<String>,
        #[arg(long)]
        examples: Option<String>,
    },
    /// Edit only the supplied fields of an existing bookmark.
    Edit {
        id: String,
        #[arg(long)]
        url: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        private_note: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        body_excerpt: Option<String>,
        #[arg(long, action = clap::ArgAction::Set)]
        include_body: Option<bool>,
        #[arg(long, action = clap::ArgAction::Set)]
        skip_ai: Option<bool>,
    },
    /// Preview allowed AI input without sending it to a model (null when skipped).
    AiEvidence { id: String },
}

fn write_collection(path: &Path, collection: &Collection, create: bool) -> Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temporary, collection)?;
    temporary.write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    if create {
        temporary.persist_noclobber(path)?;
    } else {
        temporary.persist(path)?;
    }
    Ok(())
}

fn execute(cli: Cli) -> Result<()> {
    let mut lock_path = cli.collection.as_os_str().to_os_string();
    lock_path.push(".lock");
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)?;
    lock.lock()?;

    if matches!(cli.command, Action::Init) {
        let collection = Collection::default();
        write_collection(&cli.collection, &collection, true)?;
        println!("{}", serde_json::to_string(&collection)?);
        return Ok(());
    }

    let mut collection: Collection = serde_json::from_reader(File::open(&cli.collection)?)?;
    collection.validate()?;
    match cli.command {
        Action::Save { url, title } => {
            let result = collection.save(&url, &title)?;
            if result.created {
                write_collection(&cli.collection, &collection, false)?;
            }
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::List { trash } => println!(
            "{}",
            serde_json::to_string(
                &collection
                    .bookmarks
                    .iter()
                    .filter(|bookmark| bookmark.deleted == trash)
                    .collect::<Vec<_>>()
            )?
        ),
        Action::Delete { ref id } | Action::Restore { ref id } => {
            let deleted = matches!(cli.command, Action::Delete { .. });
            let bookmark = collection.set_deleted(id, deleted)?;
            write_collection(&cli.collection, &collection, false)?;
            println!("{}", serde_json::to_string(&bookmark)?);
        }

        Action::Tags => println!("{}", serde_json::to_string(&collection.tags)?),
        Action::TagAdd {
            bookmark_id,
            tag_id,
        } => {
            let bookmark = collection.assign_tag(&bookmark_id, &tag_id, AssignmentState::Added)?;
            write_collection(&cli.collection, &collection, false)?;
            println!("{}", serde_json::to_string(&bookmark)?);
        }
        Action::TagReject {
            bookmark_id,
            tag_id,
        } => {
            let bookmark =
                collection.assign_tag(&bookmark_id, &tag_id, AssignmentState::Rejected)?;
            write_collection(&cli.collection, &collection, false)?;
            println!("{}", serde_json::to_string(&bookmark)?);
        }
        Action::TagEdit {
            id,
            definition,
            inclusion,
            exclusion,
            examples,
        } => {
            let tag = collection.edit_tag(
                &id,
                definition.as_deref(),
                inclusion.as_deref(),
                exclusion.as_deref(),
                examples.as_deref(),
            )?;
            write_collection(&cli.collection, &collection, false)?;
            println!("{}", serde_json::to_string(&tag)?);
        }
        Action::TagCreate {
            name,
            definition,
            inclusion,
            exclusion,
            examples,
        } => {
            let tag = collection.create_tag(
                &name,
                &definition,
                inclusion.as_deref(),
                exclusion.as_deref(),
                examples.as_deref(),
            )?;
            write_collection(&cli.collection, &collection, false)?;
            println!("{}", serde_json::to_string(&tag)?);
        }
        Action::Edit {
            id,
            url,
            title,
            private_note,
            description,
            body_excerpt,
            include_body,
            skip_ai,
        } => {
            let result = collection.edit(
                &id,
                BookmarkEdit {
                    url,
                    title,
                    private_note,
                    description,
                    body_excerpt,
                    include_body,
                    skip_ai,
                },
            )?;
            write_collection(&cli.collection, &collection, false)?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Action::AiEvidence { id } => {
            let bookmark = collection
                .bookmarks
                .iter()
                .find(|bookmark| bookmark.id == id)
                .ok_or("Bookmark not found")?;
            println!("{}", serde_json::to_string(&bookmark.ai_evidence())?);
        }
        Action::Init => unreachable!(),
    }
    Ok(())
}

fn main() {
    if let Err(error) = execute(Cli::parse()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
