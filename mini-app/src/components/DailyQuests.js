import React, { useState, useEffect, useRef } from 'react';

const API_URL = 'http://localhost:3001';

// Функция для склонения слова "день"
function getDaysWord(days) {
  if (days === 1) return 'день';
  if (days >= 2 && days <= 4) return 'дня';
  return 'дней';
}

export function DailyQuests({ userBalance, onBalanceUpdate, userId, selectedGroupId, vkId, companyTimezoneOffset, onRefreshBalance }) {
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const hasAutoCompleted = useRef(false);
  const [claimStatus, setClaimStatus] = useState({});
  const [countdowns, setCountdowns] = useState({});

  const getTimeRemainingText = (timeUntilNext) => {
    if (!timeUntilNext) return null;
    
    const { hours, minutes } = timeUntilNext;
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `через ${days}д ${remainingHours}ч`;
    } else if (hours > 0) {
      if (minutes > 0) {
        return `через ${hours}ч ${minutes}м`;
      }
      return `через ${hours}ч`;
    } else if (minutes > 0) {
      return `через ${minutes}м`;
    } else {
      return `через несколько секунд`;
    }
  };

  const getTimeUntilNextMs = (timeUntilNext) => {
    if (!timeUntilNext || !timeUntilNext.nextAvailableDate) return null;
    return new Date(timeUntilNext.nextAvailableDate) - new Date();
  };

  const formatCountdown = (ms) => {
    if (ms <= 0) return null;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
      return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
  };

  const checkClaimAvailability = async (questId, durationDays) => {
    if (!userId || !selectedGroupId) return { canClaim: true, timeUntilNext: null };
    
    try {
      const response = await fetch(`${API_URL}/api/users/${userId}/quests/${questId}/can-claim?durationDays=${durationDays}`);
      const data = await response.json();
      
      if (data.success) {
        return { canClaim: data.canClaim, timeUntilNext: data.timeUntilNext };
      }
    } catch (error) {
      console.error('Ошибка проверки доступности награды:', error);
    }
    
    return { canClaim: true, timeUntilNext: null };
  };

  const updateAllClaimStatuses = async (questsList) => {
    const newStatus = {};
    
    for (const quest of questsList) {
      const { canClaim, timeUntilNext } = await checkClaimAvailability(quest.id, quest.durationDays || 1);
      newStatus[quest.id] = { canClaim, timeUntilNext };
      
      if (!canClaim && timeUntilNext) {
        const msLeft = getTimeUntilNextMs(timeUntilNext);
        if (msLeft > 0) {
          setCountdowns(prev => ({
            ...prev,
            [quest.id]: msLeft
          }));
        }
      } else {
        setCountdowns(prev => {
          const newCountdowns = { ...prev };
          delete newCountdowns[quest.id];
          return newCountdowns;
        });
      }
    }
    
    setClaimStatus(newStatus);
  };

  // Функция полной синхронизации заданий с сервером
  const syncQuestsFromServer = async () => {
    if (!selectedGroupId || !userId) return;
    
    try {
      // Загружаем свежие данные с сервера
      const response = await fetch(`${API_URL}/api/quests/${selectedGroupId}`);
      if (response.ok) {
        const questsData = await response.json();
        const userProgress = await loadUserProgress();
        const userQuestProgress = userProgress?.quests || [];
        
        const transformed = questsData
          .filter(q => q.active)
          .map(q => {
            const userProgressForQuest = userQuestProgress.find(p => p.id === q.id);
            
            const targetValue = getTargetByType(q.title);
            let progress = userProgressForQuest?.progress || 0;
            const isActuallyCompleted = progress >= targetValue;
            let isClaimed = userProgressForQuest?.claimed || false;
            
            return {
              id: q.id,
              title: q.title,
              description: q.description || '',
              reward: q.reward,
              type: mapQuestType(q.title),
              target: targetValue,
              progress: progress,
              completed: isActuallyCompleted,
              claimed: isClaimed,
              emoji: q.emoji || '✅',
              durationDays: q.duration_days || 1,
              status: q.active ? 'active' : 'inactive'
            };
          });
        
        setQuests(transformed);
        await updateAllClaimStatuses(transformed);
      }
    } catch (error) {
      console.error('Ошибка синхронизации заданий:', error);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdowns(prev => {
        const newCountdowns = {};
        let hasChanges = false;
        
        for (const [questId, msLeft] of Object.entries(prev)) {
          const newMsLeft = msLeft - 1000;
          if (newMsLeft <= 0) {
            const quest = quests.find(q => q.id === parseInt(questId));
            if (quest) {
              checkClaimAvailability(quest.id, quest.durationDays || 1).then(({ canClaim, timeUntilNext }) => {
                setClaimStatus(status => ({
                  ...status,
                  [quest.id]: { canClaim, timeUntilNext }
                }));
              });
            }
            hasChanges = true;
          } else {
            newCountdowns[questId] = newMsLeft;
            hasChanges = true;
          }
        }
        
        return hasChanges ? newCountdowns : prev;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [quests]);

  const mapQuestType = (title) => {
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('воспользоваться акцией') || lowerTitle.includes('акцией')) {
      return 'use_promotion';
    }
    if (lowerTitle.includes('ежедневный вход')) {
      return 'daily_login';
    }
    if (lowerTitle.includes('потратить')) {
      return 'spend_amount';
    }
    if (lowerTitle.includes('покупк')) {
      return 'purchase_count';
    }
    if (lowerTitle.includes('колесо удачи')) {
      return 'spin_wheel';
    }
    if (lowerTitle.includes('скретч')) {
      return 'scratch_card';
    }
    if (lowerTitle.includes('кости')) {
      return 'play_dice';
    }
    
    return 'daily_login';
  };

  const getTargetByType = (title) => {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('потратить 1000')) return 1000;
    if (lowerTitle.includes('потратить 2000')) return 2000;
    if (lowerTitle.includes('2 покупки')) return 2;
    if (lowerTitle.includes('5 покупок')) return 5;
    if (lowerTitle.includes('колесо удачи 3 раза')) return 3;
    if (lowerTitle.includes('скретч-карту 3 раза')) return 3;
    if (lowerTitle.includes('кости 3 раза')) return 3;
    if (lowerTitle.includes('воспользоваться акцией')) return 1;
    if (lowerTitle.includes('ежедневный вход')) return 1;
    return 1;
  };

  const saveQuestProgressToDB = async (questId, progress, completed) => {
    if (!userId || !selectedGroupId) return;
    
    try {
      const response = await fetch(`${API_URL}/api/users/${userId}/quests/progress/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedGroupId,
          questId: questId,
          progress: progress,
          completed: completed
        })
      });
      
      if (response.ok) {
        console.log(`💾 Прогресс задания ${questId} сохранен: ${progress}`);
      }
    } catch (error) {
      console.error('Ошибка сохранения прогресса:', error);
    }
  };

  const updateQuestProgress = (questType, increment = 1) => {
    setQuests(prev => {
      const updated = prev.map(quest => {
        const questTypeFromTitle = mapQuestType(quest.title);
        
        if (questType === questTypeFromTitle && !quest.completed && !quest.claimed) {
          const targetValue = getTargetByType(quest.title);
          const newProgress = Math.min(quest.progress + increment, targetValue);
          const completed = newProgress >= targetValue;
          
          if (userId && selectedGroupId) {
            saveQuestProgressToDB(quest.id, newProgress, completed);
          }
          
          if (completed && !quest.completed) {
            console.log(`✅ Задание "${quest.title}" выполнено!`);
          }
          
          return { ...quest, progress: newProgress, completed };
        }
        return quest;
      });
      
      return updated;
    });
  };

  const updateQuestProgressRef = useRef(updateQuestProgress);

  useEffect(() => {
    updateQuestProgressRef.current = updateQuestProgress;
  }, [updateQuestProgress]);

  useEffect(() => {
    const wrappedUpdateQuestProgress = (questType, increment = 1) => {
      if (updateQuestProgressRef.current) {
        updateQuestProgressRef.current(questType, increment);
      }
    };
    
    window.updateQuestProgress = wrappedUpdateQuestProgress;
    
    const handleQuestProgress = (event) => {
      if (event.detail && updateQuestProgressRef.current) {
        updateQuestProgressRef.current(event.detail.type, event.detail.increment || 1);
      }
    };
    
    window.addEventListener('questProgress', handleQuestProgress);
    
    return () => {
      delete window.updateQuestProgress;
      window.removeEventListener('questProgress', handleQuestProgress);
    };
  }, []);

  // Получение награды за задание
  const claimQuestBonus = async (quest) => {
    if (!userId || !selectedGroupId) return;
    
    // Проверяем, не получена ли уже награда
    if (quest.claimed) {
      showNotification('❌ Вы уже получили бонус за этот период');
      return;
    }
    
    const { canClaim } = claimStatus[quest.id] || { canClaim: true };
    if (!canClaim) {
      const { timeUntilNext } = claimStatus[quest.id] || {};
      const timeText = getTimeRemainingText(timeUntilNext);
      showNotification(`❌ Бонус пока недоступен. ${timeText || 'Попробуйте позже'}`);
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/users/${userId}/quests/${quest.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedGroupId,
          reward: quest.reward
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        showNotification(`🎁 Задание "${quest.title}" выполнено! +${quest.reward} бонусов!`);
        
        if (onRefreshBalance) {
          await onRefreshBalance();
        }
        
        // ✅ КРИТИЧЕСКИ ВАЖНО: Полная синхронизация после получения награды
        await syncQuestsFromServer();
        
      } else {
        showNotification(data.message || data.error || '❌ Ошибка при получении бонуса');
      }
    } catch (error) {
      console.error('Ошибка получения бонуса:', error);
      showNotification('❌ Ошибка при получении бонуса');
    }
  };

  const handleDailyLogin = async (quest) => {
    if (!userId || !selectedGroupId) return;
    
    if (quest.completed || quest.claimed) return;
    
    setQuests(prev => prev.map(q => {
      if (q.id === quest.id) {
        return { ...q, completed: true };
      }
      return q;
    }));
    
    if (userId && selectedGroupId) {
      await saveQuestProgressToDB(quest.id, 1, true);
    }
    
    const { canClaim, timeUntilNext } = await checkClaimAvailability(quest.id, quest.durationDays || 1);
    setClaimStatus(prev => ({
      ...prev,
      [quest.id]: { canClaim, timeUntilNext }
    }));
    
    if (!canClaim && timeUntilNext) {
      const msLeft = getTimeUntilNextMs(timeUntilNext);
      if (msLeft > 0) {
        setCountdowns(prev => ({
          ...prev,
          [quest.id]: msLeft
        }));
      }
    }
    
    showNotification(`✅ Задание "${quest.title}" выполнено! Нажмите "Забрать" чтобы получить +${quest.reward} бонусов!`);
  };

  const loadUserProgress = async () => {
    if (!userId || !selectedGroupId) return null;
    try {
      const response = await fetch(`${API_URL}/api/users/${userId}/quests/progress/all`);
      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch (error) {
      console.error('Ошибка загрузки прогресса из БД:', error);
    }
    return null;
  };

  const loadQuestsFromDB = async () => {
    if (!selectedGroupId) return [];
    try {
      const response = await fetch(`${API_URL}/api/quests/${selectedGroupId}`);
      if (response.ok) {
        const questsData = await response.json();
        const userProgress = await loadUserProgress();
        const userQuestProgress = userProgress?.quests || [];
        
        const transformed = questsData
          .filter(q => q.active)
          .map(q => {
            const userProgressForQuest = userQuestProgress.find(p => p.id === q.id);
            
            const targetValue = getTargetByType(q.title);
            let progress = userProgressForQuest?.progress || 0;
            const isActuallyCompleted = progress >= targetValue;
            let isClaimed = userProgressForQuest?.claimed || false;
            
            return {
              id: q.id,
              title: q.title,
              description: q.description || '',
              reward: q.reward,
              type: mapQuestType(q.title),
              target: targetValue,
              progress: progress,
              completed: isActuallyCompleted,
              claimed: isClaimed,
              emoji: q.emoji || '✅',
              durationDays: q.duration_days || 1,
              status: q.active ? 'active' : 'inactive'
            };
          });
        
        return transformed;
      }
    } catch (error) {
      console.error('Ошибка загрузки заданий из БД:', error);
    }
    return [];
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const loadedQuests = await loadQuestsFromDB();
      setQuests(loadedQuests);
      
      await updateAllClaimStatuses(loadedQuests);
      
      setLoading(false);
    };
    if (selectedGroupId && userId) init();
  }, [selectedGroupId, userId]);

  useEffect(() => {
    if (!loading && quests.length > 0) {
      updateAllClaimStatuses(quests);
    }
  }, [quests, loading]);

  useEffect(() => {
    if (!loading && quests.length > 0 && !hasAutoCompleted.current) {
      hasAutoCompleted.current = true;
      
      const dailyLoginQuest = quests.find(q => q.type === 'daily_login' && !q.completed && !q.claimed);
      if (dailyLoginQuest) {
        handleDailyLogin(dailyLoginQuest);
      }
    }
  }, [loading, quests]);

  const showNotification = (message) => {
    const notification = document.createElement('div');
    notification.innerHTML = `<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2ecc71;padding:12px 20px;border-radius:30px;color:white;z-index:1000;animation:slideUp 0.3s ease;">${message}</div>`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  };

  const getCompletedCount = () => quests.filter(q => q.completed).length;
  const totalAvailable = quests.reduce((sum, q) => sum + (q.completed && !q.claimed ? q.reward : 0), 0);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: 20, color: 'white' }}>Загрузка заданий...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Задания</h3>
        </div>
        <div style={styles.rewardInfo}>Доступно: {totalAvailable} бонусов</div>
      </div>
      
      <div style={styles.progressOverview}>
        <div style={styles.progressBarContainer}>
          <div style={{...styles.progressBarFill, width: quests.length > 0 ? `${(getCompletedCount()/quests.length)*100}%` : '0%'}} />
        </div>
        <div style={styles.progressText}>Выполнено {getCompletedCount()} из {quests.length}</div>
      </div>
      
      <div style={styles.questsList}>
        {quests.map(quest => {
          const questClaimStatus = claimStatus[quest.id] || { canClaim: true, timeUntilNext: null };
          const countdownMs = countdowns[quest.id];
          let statusDisplay = '';
          let statusColor = '';
          
          // 🔥 ЛОГИКА ОТОБРАЖЕНИЯ СТАТУСА
          if (quest.claimed) {
            // Задание уже получено - показываем таймер до следующей возможности
            if (!questClaimStatus.canClaim && countdownMs) {
              const timeText = formatCountdown(countdownMs);
              statusDisplay = `Следующая награда через ${timeText}`;
              statusColor = '#f39c12';
            } else if (!questClaimStatus.canClaim && questClaimStatus.timeUntilNext) {
              const timeText = getTimeRemainingText(questClaimStatus.timeUntilNext);
              statusDisplay = `Следующая награда ${timeText}`;
              statusColor = '#f39c12';
            } else if (questClaimStatus.canClaim) {
              statusDisplay = 'Можно получить снова!';
              statusColor = '#2ecc71';
            } else {
              statusDisplay = 'Получено';
              statusColor = '#2ecc71';
            }
          } else if (quest.completed) {
            if (!questClaimStatus.canClaim) {
              if (countdownMs && countdownMs > 0) {
                const timeText = formatCountdown(countdownMs);
                statusDisplay = `⏱️ Доступно через ${timeText}`;
              } else {
                const timeText = getTimeRemainingText(questClaimStatus.timeUntilNext);
                statusDisplay = timeText ? `⏱️ ${timeText}` : '⏱️ Ожидание';
              }
              statusColor = '#f39c12';
            } else {
              statusDisplay = 'Готово к получению!';
              statusColor = '#2ecc71';
            }
          } else if (quest.status === 'active') {
            statusDisplay = '🟢 Активно';
            statusColor = '#2ecc71';
          } else {
            statusDisplay = '⚫ Неактивно';
            statusColor = '#888';
          }
          
          const isDailyQuest = quest.durationDays === 1;
          
          return (
            <div key={quest.id} style={{...styles.questItem, background: quest.completed ? 'rgba(46,204,113,0.15)' : 'rgba(0,0,0,0.3)', borderLeft: quest.completed ? '3px solid #2ecc71' : '3px solid transparent'}}>
              <div style={styles.questInfo}>
                <div style={styles.questTitle}>
                  <span style={{ fontSize: 24, marginRight: 8 }}>{quest.emoji}</span>
                  {quest.title}
                  {isDailyQuest && quest.durationDays === 1 && (
                    <span style={{ fontSize: 10, marginLeft: 8, background: '#f39c12', padding: '2px 6px', borderRadius: 12, color: '#333' }}>
                      Ежедневное
                    </span>
                  )}
                  {quest.durationDays > 1 && (
                    <span style={{ fontSize: 10, marginLeft: 8, background: '#3498db', padding: '2px 6px', borderRadius: 12, color: 'white' }}>
                      Раз в {quest.durationDays} {getDaysWord(quest.durationDays)}
                    </span>
                  )}
                </div>
                <div style={styles.questDescription}>{quest.description}</div>
                
                {quest.target > 1 && !quest.claimed && !quest.completed && (
                  <div style={styles.questProgress}>
                    <div style={styles.progressBarContainerSmall}>
                      <div style={{...styles.progressBarFillSmall, width: `${(quest.progress/quest.target)*100}%`}} />
                    </div>
                    <span style={styles.progressTextSmall}>{quest.progress}/{quest.target}</span>
                  </div>
                )}
                
                {quest.target > 1 && quest.completed && !quest.claimed && (
                  <div style={styles.questProgress}>
                    <div style={styles.progressBarContainerSmall}>
                      <div style={{...styles.progressBarFillSmall, width: `100%`, background: '#2ecc71'}} />
                    </div>
                    <span style={styles.progressTextSmall}>Выполнено!</span>
                  </div>
                )}
                
                <div style={{ ...styles.questStatus, color: statusColor, fontSize: 13, fontWeight: 500, marginTop: 6 }}>
                  {statusDisplay}
                </div>
              </div>
              <div style={styles.questReward}>
                <div style={styles.rewardValue}>+{quest.reward}</div>
                <div style={styles.rewardLabel}>бонусов</div>
                {!quest.completed ? (
                  <div style={{ ...styles.statusPending, color: quest.status === 'active' ? '#aaa' : '#888' }}>
                    {quest.status === 'active' ? 'Не выполнено' : 'Неактивно'}
                  </div>
                ) : quest.claimed ? (
                  
                  <div style={styles.statusClaimed}>Получено</div>
                ) : (
                  <button 
                    onClick={() => claimQuestBonus(quest)} 
                    style={{
                      ...styles.claimButton,
                      background: questClaimStatus.canClaim ? '#ff4d4d' : '#666',
                      cursor: questClaimStatus.canClaim ? 'pointer' : 'not-allowed'
                    }}
                    disabled={!questClaimStatus.canClaim}
                  >
                    Забрать
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {quests.length === 0 && (
        <div style={{ textAlign: 'center', padding: 20, opacity: 0.7, color: 'white' }}>Нет активных заданий</div>
      )}
      
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: { background: 'rgba(30, 35, 48, 0.7)', borderRadius: 28, padding: 20, marginBottom: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 18, fontWeight: 700, margin: 0, color: 'white' },
  rewardInfo: { fontSize: 13, color: '#ffd966', background: 'rgba(255,215,0,0.15)', padding: '6px 12px', borderRadius: 20 },
  progressOverview: { marginBottom: 20, padding: '12px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: 16 },
  progressBarContainer: { height: 6, background: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  progressBarFill: { height: '100%', background: 'linear-gradient(90deg,#2ecc71,#27ae60)', borderRadius: 3, transition: 'width 0.3s' },
  progressText: { fontSize: 11, opacity: 0.7, textAlign: 'center', color: 'white' },
  questsList: { display: 'flex', flexDirection: 'column', gap: 10 },
  questItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderRadius: 20, flexWrap: 'wrap', gap: 12 },
  questInfo: { flex: 1 },
  questTitle: { fontWeight: 700, marginBottom: 4, color: 'white', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  questDescription: { fontSize: 12, opacity: 0.7, marginBottom: 4, color: 'white' },
  questStatus: { fontSize: 12, marginBottom: 4 },
  questProgress: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 },
  progressBarContainerSmall: { flex: 1, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  progressBarFillSmall: { height: '100%', background: '#ffd966', borderRadius: 2, transition: 'width 0.3s' },
  progressTextSmall: { fontSize: 10, opacity: 0.7, minWidth: 70, color: 'white' },
  questReward: { textAlign: 'center', minWidth: 90 },
  rewardValue: { fontSize: 18, fontWeight: 'bold', color: '#ffd966' },
  rewardLabel: { fontSize: 10, opacity: 0.7, marginBottom: 8, color: 'white' },
  statusPending: { fontSize: 11 },
  statusClaimed: { fontSize: 11, color: '#2ecc71' },
  claimButton: { background: '#ff4d4d', border: 'none', padding: '6px 12px', borderRadius: 20, color: 'white', fontSize: 12, cursor: 'pointer', width: '100%' }
};