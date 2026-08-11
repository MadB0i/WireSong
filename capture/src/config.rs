use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct InstrumentPack {
    pub scale: ScaleConfig,
    #[serde(rename = "event")]
    pub events: HashMap<String, EventConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScaleConfig {
    pub notes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventConfig {
    pub duration_ms: Option<u32>,
    pub duration_ms_min: Option<u32>,
    pub duration_ms_max: Option<u32>,
    pub velocity_base: f32,
    #[allow(dead_code)]
    pub waveform: String,
    pub scale_degree_offset: Option<u8>,
}

pub fn load_instrument_pack(
    path: &Path,
) -> Result<InstrumentPack, Box<dyn std::error::Error + Send + Sync>> {
    let contents = std::fs::read_to_string(path)?;
    Ok(toml::from_str(&contents)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_ambient_pack_with_scale_and_duration() {
        let pack = load_instrument_pack(Path::new("instruments/ambient.toml"))
            .expect("ambient.toml should load");
        assert_eq!(pack.scale.notes.len(), 10);
        assert_eq!(pack.scale.notes[0], 60);
        assert_eq!(pack.scale.notes[9], 81);

        let tcp_syn = pack.events.get("tcp_syn").expect("tcp_syn event config");
        assert_eq!(tcp_syn.duration_ms, Some(180));
        assert_eq!(tcp_syn.velocity_base, 0.6);
        assert_eq!(tcp_syn.waveform, "pluck");
    }
}
