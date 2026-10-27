import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { api, CrewTrack } from '../lib/api';
import { NATIVE_AUDIO, useNativeAudio } from '../lib/nativeAudio';
import { theme } from '../theme';

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtSize(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTiempo(seg?: number | null) {
  if (!seg || seg <= 0) return '';
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
  m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac',
};

// ─── Componente principal ─────────────────────────────────────────────────────
export default function LibraryCrew() {
  const native = useNativeAudio();
  const [tracks, setTracks] = useState<CrewTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [userEmail, setUserEmail] = useState('');
  const webAudioRef = useRef<any>(null);

  // Campos del modal de subida
  const [uTitle, setUTitle] = useState('');
  const [uArtist, setUArtist] = useState('');
  const [uFile, setUFile] = useState<{ uri: string; name: string; size?: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('qp_user_email').then(v => { if (v) setUserEmail(v); }).catch(() => {});
    cargar();
  }, []);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.crewListTracks('main');
      setTracks(data.tracks || []);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar Library Crew');
    } finally {
      setLoading(false);
    }
  }

  async function elegirArchivo() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUFile({ uri: asset.uri, name: asset.name, size: asset.size });
      // Auto-completar título con el nombre del archivo
      if (!uTitle) {
        const nombre = asset.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
        setUTitle(nombre);
      }
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo abrir el selector de archivos: ' + (e?.message || ''));
    }
  }

  async function subirArchivo() {
    if (!uFile || !uTitle.trim()) {
      Alert.alert('Falta info', 'Seleccioná un archivo y escribí el título');
      return;
    }
    const ext = uFile.name.split('.').pop()?.toLowerCase() || 'mp3';
    const contentType = MIME_MAP[ext] || 'audio/mpeg';

    setUploading(true);
    setUploadProgress(0);
    try {
      // Upload proxeado por el server (evita CORS de R2 en web/iPhone)
      await api.crewUpload({
        fileUri: uFile.uri,
        filename: uFile.name,
        contentType,
        title: uTitle.trim(),
        artist: uArtist.trim(),
        crew_id: 'main',
        uploaded_by: userEmail,
        onProgress: (pct) => setUploadProgress(pct),
      });
      setUploadProgress(100);

      Alert.alert('¡Listo!', `"${uTitle}" subido a Library Crew 👥`);
      setUploadOpen(false);
      setUTitle(''); setUArtist(''); setUFile(null);
      cargar();
    } catch (e: any) {
      Alert.alert('Error al subir', e?.message || 'Error desconocido');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function reproducir(track: CrewTrack) {
    if (!NATIVE_AUDIO) {
      if (typeof window !== 'undefined' && typeof (window as any).Audio !== 'undefined') {
        try {
          if (webAudioRef.current) {
            webAudioRef.current.pause();
            webAudioRef.current = null;
          }
          if (playingId === track.id) {
            setPlayingId(null);
            return;
          }
          const a = new Audio(track.audio_url);
          webAudioRef.current = a;
          a.onended = () => setPlayingId(null);
          a.onerror = () => { Alert.alert('Error', 'No se pudo reproducir en el navegador'); setPlayingId(null); };
          setPlayingId(track.id);
          await a.play();
          return;
        } catch (e: any) {
          Alert.alert('Error', e?.message || 'Error en reproductor web');
          setPlayingId(null);
          return;
        }
      }
      Alert.alert('Solo disponible en Android', 'Library Crew se reproduce con el reproductor nativo en segundo plano.');
      return;
    }
    try {
      setPlayingId(track.id);
      await native.play(track.audio_url, track.title);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo reproducir');
      setPlayingId(null);
    }
  }

  async function eliminar(track: CrewTrack) {
    Alert.alert(
      'Eliminar track',
      `¿Eliminar "${track.title}" de Library Crew? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            try {
              await api.crewDeleteTrack(track.id);
              if (playingId === track.id) setPlayingId(null);
              setTracks(prev => prev.filter(t => t.id !== track.id));
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'No se pudo eliminar');
            }
          },
        },
      ]
    );
  }

  const renderTrack = useCallback(({ item }: { item: CrewTrack }) => {
    const isPlaying = playingId === item.id;
    return (
      <View style={s.trackRow}>
        <Pressable style={s.trackInfo} onPress={() => reproducir(item)}>
          <View style={s.trackIcon}>
            <Text style={s.trackIconText}>{isPlaying ? '▶️' : '🎵'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.trackTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={s.trackMeta} numberOfLines={1}>
              {[item.artist, fmtTiempo(item.duration), fmtSize(item.file_size)].filter(Boolean).join(' · ')}
            </Text>
            {item.uploaded_by ? (
              <Text style={s.trackUploader}>por {item.uploaded_by}</Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable style={s.deleteBtn} onPress={() => eliminar(item)} hitSlop={8}>
          <Text style={s.deleteBtnText}>🗑</Text>
        </Pressable>
      </View>
    );
  }, [playingId]);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>👥 Library Crew</Text>
        <Text style={s.headerSub}>Bóveda privada de música & stems</Text>
      </View>

      {/* Barra de acciones */}
      <View style={s.actionRow}>
        <Pressable style={s.uploadBtn} onPress={() => setUploadOpen(true)}>
          <Text style={s.uploadBtnText}>⬆️  Subir track</Text>
        </Pressable>
        <Pressable style={s.refreshBtn} onPress={cargar} disabled={loading}>
          <Text style={s.refreshBtnText}>{loading ? '…' : '↻'}</Text>
        </Pressable>
      </View>

      {/* Error */}
      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={cargar}><Text style={s.retryText}>Reintentar</Text></Pressable>
        </View>
      ) : null}

      {/* Lista */}
      {loading && !tracks.length ? (
        <ActivityIndicator color={theme.colors.gold} style={{ marginTop: 40 }} />
      ) : tracks.length === 0 && !loading ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyIcon}>🎵</Text>
          <Text style={s.emptyText}>Library Crew está vacía</Text>
          <Text style={s.emptySub}>Subí los primeros tracks de tu crew con el botón de arriba</Text>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={t => t.id}
          renderItem={renderTrack}
          contentContainerStyle={{ paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={s.sep} />}
        />
      )}

      {/* Modal de subida */}
      <Modal visible={uploadOpen} transparent animationType="slide" onRequestClose={() => !uploading && setUploadOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>⬆️ Subir a Library Crew</Text>

            <Pressable style={s.filePicker} onPress={elegirArchivo} disabled={uploading}>
              <Text style={s.filePickerText}>
                {uFile ? `📂 ${uFile.name}` : '📂 Elegir archivo de audio…'}
              </Text>
              {uFile?.size ? <Text style={s.fileSizeText}>{fmtSize(uFile.size)}</Text> : null}
            </Pressable>

            <TextInput
              style={s.modalInput}
              placeholder="Título *"
              placeholderTextColor={theme.colors.textDim}
              value={uTitle}
              onChangeText={setUTitle}
              editable={!uploading}
            />
            <TextInput
              style={s.modalInput}
              placeholder="Artista (opcional)"
              placeholderTextColor={theme.colors.textDim}
              value={uArtist}
              onChangeText={setUArtist}
              editable={!uploading}
            />

            {/* Progress bar */}
            {uploading ? (
              <View style={s.progressWrap}>
                <View style={[s.progressBar, { width: `${uploadProgress}%` as any }]} />
                <Text style={s.progressText}>{uploadProgress < 100 ? `Subiendo… ${uploadProgress}%` : '¡Listo!'}</Text>
              </View>
            ) : null}

            <View style={s.modalBtns}>
              <Pressable style={s.cancelBtn} onPress={() => setUploadOpen(false)} disabled={uploading}>
                <Text style={s.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable style={[s.confirmBtn, (!uFile || !uTitle || uploading) && s.btnDisabled]} onPress={subirArchivo} disabled={!uFile || !uTitle || uploading}>
                {uploading
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={s.confirmBtnText}>Subir</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { padding: 20, paddingBottom: 8, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  headerTitle: { fontSize: 22, fontWeight: '700', color: theme.colors.gold },
  headerSub: { fontSize: 13, color: theme.colors.textDim, marginTop: 2 },
  actionRow: { flexDirection: 'row', padding: 12, gap: 10 },
  uploadBtn: { flex: 1, backgroundColor: theme.colors.gold, borderRadius: 10, padding: 12, alignItems: 'center' },
  uploadBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  refreshBtn: { backgroundColor: theme.colors.surface, borderRadius: 10, padding: 12, paddingHorizontal: 18, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
  refreshBtnText: { color: theme.colors.text, fontSize: 18 },
  errorBox: { margin: 16, padding: 14, backgroundColor: '#3a1515', borderRadius: 10, borderWidth: 1, borderColor: '#ff4444' },
  errorText: { color: '#ff8888', marginBottom: 8 },
  retryText: { color: theme.colors.gold, fontWeight: '700' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginBottom: 6 },
  emptySub: { fontSize: 13, color: theme.colors.textDim, textAlign: 'center' },
  trackRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  trackInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  trackIconText: { fontSize: 20 },
  trackTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  trackMeta: { fontSize: 12, color: theme.colors.textDim, marginTop: 2 },
  trackUploader: { fontSize: 11, color: theme.colors.gold + '99', marginTop: 1 },
  deleteBtn: { padding: 8 },
  deleteBtnText: { fontSize: 18 },
  sep: { height: 1, backgroundColor: theme.colors.border, marginHorizontal: 16 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.gold, marginBottom: 20 },
  filePicker: { backgroundColor: theme.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed', padding: 16, alignItems: 'center', marginBottom: 14 },
  filePickerText: { color: theme.colors.text, fontSize: 15 },
  fileSizeText: { color: theme.colors.textDim, fontSize: 12, marginTop: 4 },
  modalInput: { backgroundColor: theme.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, color: theme.colors.text, fontSize: 15, marginBottom: 12 },
  progressWrap: { backgroundColor: theme.colors.bg, borderRadius: 8, height: 28, overflow: 'hidden', marginBottom: 14, justifyContent: 'center' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.colors.gold, borderRadius: 8 },
  progressText: { textAlign: 'center', color: '#000', fontWeight: '700', fontSize: 13, zIndex: 1 },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  cancelBtnText: { color: theme.colors.textDim, fontWeight: '600' },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: theme.colors.gold, alignItems: 'center' },
  confirmBtnText: { color: '#000', fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
});
