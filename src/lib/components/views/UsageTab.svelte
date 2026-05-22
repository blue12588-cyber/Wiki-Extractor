<!--
  UsageTab.svelte — 사용법 (Slice 6 · AC-USAGE-TAB + AC-KOREAN-UI)
  ---------------------------------------------------------------
  로그인-피드백 사이에 놓이는 사용법 탭. 대상은 AI·IT를 잘 모르는 일반인(20-40대).
  네 단계(원서 넣기 → 후보 자동 추출 → ChatGPT로 정리 → 위키 검토·저장)를
  친근한 한글로 안내한다. 전문용어·내부 jargon은 최소화하고, 꼭 필요한 곳에만
  쉬운 풀이를 붙인다.

  설계: 단계마다 큰 번호 + 짧은 제목 + 한두 문장 설명. 색상에만 의존하지 않도록
  번호 원형은 텍스트(①②③④) + 테두리로 구분된다(접근성). 토큰만 사용한다.

  이 탭은 어떤 인증도 필요 없고, 어떤 데이터도 바꾸지 않는다(읽기 전용 안내).
-->
<script lang="ts">
  // 순수 안내 화면 — 상태/네트워크/저장 없음.
  const steps = [
    {
      n: '①',
      title: '원서(읽을 책·자료)를 넣기',
      body:
        '정리하고 싶은 책이나 자료 파일을 [메인] 화면으로 끌어다 놓거나, [파일 선택]으로 고릅니다. PDF, 일반 텍스트(.txt), 마크다운(.md) 파일을 넣을 수 있어요. 파일은 내 컴퓨터 안에서만 다뤄집니다.',
    },
    {
      n: '②',
      title: '후보를 자동으로 뽑기',
      body:
        '파일을 넣으면 앱이 긴 내용을 읽기 좋은 크기로 잘게 나눠, 위키로 만들 만한 “후보”(중요한 개념·주장·인물 등)를 스스로 찾아 카드로 보여 줍니다. 이 단계는 인터넷 없이도 동작합니다.',
    },
    {
      n: '③',
      title: 'ChatGPT로 정리하기 (두 가지 방법)',
      body: null, // 이 단계는 아래 두 갈래로 나눠 설명
    },
    {
      n: '④',
      title: '위키를 검토하고 저장하기',
      body:
        '정리된 후보 카드를 하나씩 보면서 [승인]·[보류]·[폐기]를 고릅니다. 내용이 마음에 안 들면 직접 고쳐 쓸 수도 있어요. 승인한 항목만 내 위키에 저장되고, 나중에 [위키] 화면에서 다시 보고 편집할 수 있습니다.',
    },
  ];
</script>

<section class="usage">
  <header class="intro">
    <h2 class="section-title">사용법 — 처음 쓰는 분께</h2>
    <p class="section-lede">
      이 앱은 읽은 책·자료에서 중요한 내용을 뽑아 나만의 “위키”(쉽게 말해, 정리된
      메모 모음)로 만들어 줍니다. 아래 네 단계만 따라 하면 됩니다. 어려운 설정이나
      가입은 필요 없어요.
    </p>
  </header>

  <ol class="step-list" role="list">
    {#each steps as step (step.n)}
      <li class="step">
        <span class="step-num" aria-hidden="true">{step.n}</span>
        <div class="step-text">
          <h3 class="step-title">{step.title}</h3>
          {#if step.body}
            <p class="step-body">{step.body}</p>
          {:else}
            <!-- ③ 단계: 복붙 방식(기본) / 자동 방식(로그인 시) 두 갈래 -->
            <p class="step-body">
              뽑은 후보를 더 깔끔하게 다듬으려면 ChatGPT의 도움을 받습니다.
              방법은 두 가지이고, <strong>어느 쪽이든 결과는 같습니다.</strong>
            </p>

            <div class="branch" data-kind="paste">
              <h4 class="branch-title">방법 A · 복사해서 붙여넣기 <span class="branch-tag">기본 · 누구나</span></h4>
              <ol class="branch-steps" role="list">
                <li>[ChatGPT 프롬프트 복사] 버튼을 누르면 보낼 내용이 통째로 복사됩니다.</li>
                <li>웹브라우저에서 <code>chatgpt.com</code>에 들어가 빈칸에 그대로 붙여넣고 보냅니다.</li>
                <li>ChatGPT가 답한 내용을 다시 복사해서, 앱의 입력칸에 붙여넣습니다.</li>
              </ol>
              <p class="branch-note">
                가입·로그인 외에 따로 설치할 것이 없어, 누구나 바로 쓸 수 있는
                기본 방법입니다.
              </p>
            </div>

            <div class="branch" data-kind="auto">
              <h4 class="branch-title">방법 B · 자동으로 처리 <span class="branch-tag">선택 · 로그인하면</span></h4>
              <p class="branch-note">
                [로그인] 화면에서 <strong>[ChatGPT로 로그인]</strong> 버튼을 눌러
                내 ChatGPT 계정으로 한 번 로그인해 두면, 위 복사·붙여넣기 과정을
                앱이 알아서 대신 해 줍니다. 로그인은 브라우저에서 진행되고,
                아이디·비밀번호를 앱에 입력하지 않습니다.
              </p>
              <p class="branch-note muted">
                이 방법은 선택 사항이에요. 로그인하지 않아도 <strong>방법 A</strong>로
                모든 기능을 똑같이 쓸 수 있습니다.
              </p>
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  <footer class="outro" role="note">
    막히는 부분이 있으면 [피드백] 화면으로 편하게 알려 주세요. 로그인 없이 보낼 수
    있습니다.
  </footer>
</section>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .section-title {
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
    margin: 0;
  }

  .section-lede {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .step-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .step {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-md);
    align-items: start;
    padding: var(--space-lg);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
  }

  .step-num {
    font-family: var(--heading-family);
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--accent-oxblood);
    width: 1.6em;
    text-align: center;
  }

  .step-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .step-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .step-body {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.65;
  }

  .branch {
    margin-top: var(--space-sm);
    padding: var(--space-md) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    background: var(--surface-sunken);
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .branch[data-kind='auto'] {
    border-style: dashed;
  }

  .branch-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .branch-tag {
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .branch-steps {
    margin: var(--space-xs) 0 0 0;
    padding-left: 1.3em;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .branch-note {
    margin: var(--space-xs) 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .branch-note.muted {
    color: var(--text-secondary);
    opacity: 0.9;
  }

  .outro {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
    padding: var(--space-md);
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-base);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
