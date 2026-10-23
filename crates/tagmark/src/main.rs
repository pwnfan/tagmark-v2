use clap::{Parser, Subcommand};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tagmark::{Collection, Result};

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
    /// List the saved bookmarks as JSON.
    List,
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
        Action::List => println!("{}", serde_json::to_string(&collection.bookmarks)?),
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
